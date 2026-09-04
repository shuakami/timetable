package app.timetable;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Shader;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Size;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 相机与相册：CameraX 预览叠在 WebView 上方的取景区，页面自己画四周的黑底与控件。
 * 拍摄直接写应用私有目录，缩略图走 ContentResolver.loadThumbnail，图片字节不经过 JS。
 */
@CapacitorPlugin(
        name = "TtCamera",
        permissions = {
                @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
                @Permission(alias = "photos", strings = { Manifest.permission.READ_EXTERNAL_STORAGE, "android.permission.READ_MEDIA_IMAGES" }),
        }
)
public class TtCamera extends Plugin {

    private static final String DIR = "task-photos";

    /** 取景容器：叠在 WebView 上方、圆角裁切，里面是预览 + 四角标记 */
    private FrameLayout frame;
    private PreviewView previewView;
    private ProcessCameraProvider provider;
    private ImageCapture capture;
    private androidx.camera.core.Camera camera;
    private int lensFacing = CameraSelector.LENS_FACING_BACK;
    private ExecutorService io;

    @Override
    public void load() {
        io = Executors.newSingleThreadExecutor();
        // 提前初始化 CameraX，进相机页时少等几百毫秒
        ProcessCameraProvider.getInstance(getContext());
    }

    /* ---------------- 权限 ---------------- */

    private String photosPermission() {
        return Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_IMAGES" : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    private boolean has(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    /** Android 14 的“选中的照片”也算可读 */
    private boolean hasPhotos() {
        if (Build.VERSION.SDK_INT >= 34
                && ContextCompat.checkSelfPermission(getContext(), "android.permission.READ_MEDIA_VISUAL_USER_SELECTED") == PackageManager.PERMISSION_GRANTED) {
            return true;
        }
        return has(photosPermission());
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject o = new JSObject();
        o.put("camera", has(Manifest.permission.CAMERA) ? "granted" : "prompt");
        o.put("photos", hasPhotos() ? "granted" : "prompt");
        call.resolve(o);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        String kind = call.getString("kind", "camera");
        String permission = "photos".equals(kind) ? photosPermission() : Manifest.permission.CAMERA;
        if (has(permission)) {
            JSObject o = new JSObject();
            o.put("status", "granted");
            call.resolve(o);
            return;
        }
        requestPermissionForAlias("photos".equals(kind) ? "photos" : "camera", call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        String kind = call.getString("kind", "camera");
        boolean ok = "photos".equals(kind) ? hasPhotos() : has(Manifest.permission.CAMERA);
        JSObject o = new JSObject();
        o.put("status", ok ? "granted" : "denied");
        call.resolve(o);
    }

    /* ---------------- 预览 ---------------- */

    private int dp(double v) {
        return (int) Math.round(v * getContext().getResources().getDisplayMetrics().density);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!has(Manifest.permission.CAMERA)) {
            call.reject("no-permission");
            return;
        }
        String position = call.getString("position", "back");
        lensFacing = "front".equals(position) ? CameraSelector.LENS_FACING_FRONT : CameraSelector.LENS_FACING_BACK;
        final int x = dp(call.getDouble("x", 0d));
        final int y = dp(call.getDouble("y", 0d));
        final int w = dp(call.getDouble("width", 0d));
        final int h = dp(call.getDouble("height", 0d));
        final long revealAt = System.currentTimeMillis() + call.getInt("delay", 0);

        getActivity().runOnUiThread(() -> {
            try {
                ViewGroup root = (ViewGroup) getBridge().getWebView().getParent();
                if (frame == null) {
                    previewView = new PreviewView(getContext());
                    previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
                    previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
                    frame = new FrameLayout(getContext());
                    frame.setClickable(false);
                    frame.setFocusable(false);
                    frame.setAlpha(0f);
                    final FrameLayout f = frame;
                    // 第一帧到了、且页面推入动画走完，再淡入；不让黑屏/拉伸的中间态露出来
                    previewView.getPreviewStreamState().observe((LifecycleOwner) getActivity(), state -> {
                        if (state != PreviewView.StreamState.STREAMING || f != frame || f.getAlpha() > 0f) return;
                        long wait = Math.max(0, revealAt - System.currentTimeMillis());
                        f.postDelayed(() -> {
                            if (f != frame) return;
                            f.animate().alpha(1f).setDuration(220).start();
                        }, wait);
                    });
                    frame.addView(previewView, new FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                    frame.addView(new FrameOverlay(getContext()), new FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                    final float radius = dp(24);
                    frame.setOutlineProvider(new ViewOutlineProvider() {
                        @Override
                        public void getOutline(View v, Outline outline) {
                            outline.setRoundRect(0, 0, v.getWidth(), v.getHeight(), radius);
                        }
                    });
                    frame.setClipToOutline(true);
                    root.addView(frame);
                }
                ViewGroup.LayoutParams lp = frame.getLayoutParams();
                lp.width = w > 0 ? w : ViewGroup.LayoutParams.MATCH_PARENT;
                lp.height = h > 0 ? h : ViewGroup.LayoutParams.MATCH_PARENT;
                if (lp instanceof ViewGroup.MarginLayoutParams) {
                    ((ViewGroup.MarginLayoutParams) lp).setMargins(x, y, 0, 0);
                }
                if (lp instanceof CoordinatorLayout.LayoutParams) {
                    ((CoordinatorLayout.LayoutParams) lp).gravity = Gravity.TOP | Gravity.START;
                } else if (lp instanceof FrameLayout.LayoutParams) {
                    ((FrameLayout.LayoutParams) lp).gravity = Gravity.TOP | Gravity.START;
                }
                frame.setLayoutParams(lp);

                bindCamera(call);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    private void bindCamera(PluginCall call) {
        com.google.common.util.concurrent.ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(getContext());
        future.addListener(() -> {
            try {
                provider = future.get();
                provider.unbindAll();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());
                capture = new ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .setTargetResolution(new Size(1440, 1920))
                        .build();
                CameraSelector selector = new CameraSelector.Builder().requireLensFacing(lensFacing).build();
                camera = provider.bindToLifecycle((LifecycleOwner) getActivity(), selector, preview, capture);
                if (call != null) {
                    JSObject o = new JSObject();
                    o.put("position", lensFacing == CameraSelector.LENS_FACING_FRONT ? "front" : "back");
                    call.resolve(o);
                }
            } catch (Exception e) {
                if (call != null) call.reject(e.getMessage());
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    /**
     * 收起预览：先把当前画面定格成一张图交给页面，页面用它填在取景框里，
     * 之后的切页动画就全在 WebView 内完成，原生层消失时不会看到空洞。
     */
    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject o = new JSObject();
            if (previewView != null && frame != null && frame.getAlpha() > 0f) {
                try {
                    Bitmap b = previewView.getBitmap();
                    if (b != null) {
                        int max = 720;
                        if (b.getWidth() > max) {
                            b = Bitmap.createScaledBitmap(b, max, Math.round(b.getHeight() * (float) max / b.getWidth()), true);
                        }
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        b.compress(Bitmap.CompressFormat.JPEG, 82, bo);
                        o.put("frozen", "data:image/jpeg;base64," + android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP));
                    }
                } catch (Exception ignored) {
                }
            }
            if (provider != null) provider.unbindAll();
            if (frame != null && frame.getParent() != null) {
                ((ViewGroup) frame.getParent()).removeView(frame);
            }
            frame = null;
            previewView = null;
            capture = null;
            camera = null;
            call.resolve(o);
        });
    }

    @PluginMethod
    public void switchCamera(PluginCall call) {
        lensFacing = lensFacing == CameraSelector.LENS_FACING_BACK ? CameraSelector.LENS_FACING_FRONT : CameraSelector.LENS_FACING_BACK;
        getActivity().runOnUiThread(() -> bindCamera(call));
    }

    @PluginMethod
    public void setTorch(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) {
            call.resolve();
            return;
        }
        camera.getCameraControl().enableTorch(on);
        call.resolve();
    }

    /** 取景框上的四角标记与上下渐变，和页面里的样式一致 */
    private final class FrameOverlay extends View {
        private final Paint corner = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint shade = new Paint();
        private final Path path = new Path();

        FrameOverlay(Context ctx) {
            super(ctx);
            corner.setStyle(Paint.Style.STROKE);
            corner.setStrokeWidth(dp(2));
            corner.setColor(Color.argb(204, 255, 255, 255));
            corner.setStrokeCap(Paint.Cap.BUTT);
            corner.setStrokeJoin(Paint.Join.ROUND);
            setClickable(false);
        }

        @Override
        protected void onSizeChanged(int w, int h, int ow, int oh) {
            shade.setShader(new LinearGradient(0, 0, 0, h,
                    new int[] { Color.argb(64, 0, 0, 0), Color.TRANSPARENT, Color.TRANSPARENT, Color.argb(89, 0, 0, 0) },
                    new float[] { 0f, .3f, .75f, 1f }, Shader.TileMode.CLAMP));
        }

        @Override
        protected void onDraw(Canvas c) {
            int w = getWidth();
            int h = getHeight();
            c.drawRect(0, 0, w, h, shade);
            float in = dp(20) + dp(1);
            float len = dp(24);
            float r = dp(8);
            drawCorner(c, in, in, 1, 1, len, r);
            drawCorner(c, w - in, in, -1, 1, len, r);
            drawCorner(c, in, h - in, 1, -1, len, r);
            drawCorner(c, w - in, h - in, -1, -1, len, r);
        }

        /** 以 (x, y) 为角点，sx/sy 指向框内的方向，画一段带圆角的 L 形 */
        private void drawCorner(Canvas c, float x, float y, int sx, int sy, float len, float r) {
            path.reset();
            path.moveTo(x, y + sy * len);
            path.lineTo(x, y + sy * r);
            path.quadTo(x, y, x + sx * r, y);
            path.lineTo(x + sx * len, y);
            c.drawPath(path, corner);
        }
    }

    /* ---------------- 拍摄 ---------------- */

    private File photoDir() {
        File dir = new File(getContext().getFilesDir(), DIR);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    @PluginMethod
    public void capture(PluginCall call) {
        if (capture == null) {
            call.reject("not-started");
            return;
        }
        final boolean mirror = lensFacing == CameraSelector.LENS_FACING_FRONT;
        capture.takePicture(io, new ImageCapture.OnImageCapturedCallback() {
            @Override
            public void onCaptureSuccess(@NonNull ImageProxy image) {
                try {
                    ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                    byte[] bytes = new byte[buffer.remaining()];
                    buffer.get(bytes);
                    int rotation = image.getImageInfo().getRotationDegrees();
                    image.close();
                    JSObject o = writeJpeg(bytes, rotation, mirror);
                    call.resolve(o);
                } catch (Exception e) {
                    image.close();
                    call.reject(e.getMessage());
                }
            }

            @Override
            public void onError(@NonNull ImageCaptureException e) {
                call.reject(e.getMessage());
            }
        });
    }

    /** 写入私有目录；需要旋转/镜像时才解码一次，否则直接落盘 */
    private JSObject writeJpeg(byte[] jpeg, int rotation, boolean mirror) throws Exception {
        String name = "p" + System.currentTimeMillis() + ".jpg";
        File out = new File(photoDir(), name);
        int w;
        int h;
        if (rotation == 0 && !mirror) {
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(jpeg);
            }
            android.graphics.BitmapFactory.Options opt = new android.graphics.BitmapFactory.Options();
            opt.inJustDecodeBounds = true;
            android.graphics.BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, opt);
            w = opt.outWidth;
            h = opt.outHeight;
        } else {
            Bitmap src = android.graphics.BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
            Matrix m = new Matrix();
            m.postRotate(rotation);
            if (mirror) m.postScale(-1, 1);
            Bitmap fixed = Bitmap.createBitmap(src, 0, 0, src.getWidth(), src.getHeight(), m, true);
            if (fixed != src) src.recycle();
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fixed.compress(Bitmap.CompressFormat.JPEG, 92, fos);
            }
            w = fixed.getWidth();
            h = fixed.getHeight();
            fixed.recycle();
        }
        JSObject o = new JSObject();
        o.put("path", DIR + "/" + name);
        o.put("uri", Uri.fromFile(out).toString());
        o.put("width", w);
        o.put("height", h);
        return o;
    }

    /* ---------------- 相册 ---------------- */

    @PluginMethod
    public void listRecent(PluginCall call) {
        if (!hasPhotos()) {
            call.reject("no-permission");
            return;
        }
        int limit = call.getInt("limit", 60);
        int page = call.getInt("page", 0);
        io.execute(() -> {
            try {
                JSArray items = new JSArray();
                ContentResolver cr = getContext().getContentResolver();
                String[] cols = { MediaStore.Images.Media._ID, MediaStore.Images.Media.WIDTH, MediaStore.Images.Media.HEIGHT };
                try (Cursor c = cr.query(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cols, null, null,
                        MediaStore.Images.Media.DATE_ADDED + " DESC LIMIT " + limit + " OFFSET " + (page * limit))) {
                    while (c != null && c.moveToNext()) {
                        long id = c.getLong(0);
                        Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
                        JSObject o = new JSObject();
                        o.put("id", String.valueOf(id));
                        o.put("width", c.getInt(1));
                        o.put("height", c.getInt(2));
                        o.put("thumb", thumbBase64(uri));
                        items.put(o);
                    }
                }
                JSObject res = new JSObject();
                res.put("items", items);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    /** 缩略图很小（240px），只有它走 base64；原图始终走文件路径 */
    private String thumbBase64(Uri uri) {
        try {
            Bitmap bmp;
            if (Build.VERSION.SDK_INT >= 29) {
                bmp = getContext().getContentResolver().loadThumbnail(uri, new Size(240, 240), null);
            } else {
                bmp = MediaStore.Images.Thumbnails.getThumbnail(
                        getContext().getContentResolver(), ContentUris.parseId(uri),
                        MediaStore.Images.Thumbnails.MINI_KIND, null);
            }
            if (bmp == null) return "";
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 70, bos);
            bmp.recycle();
            return "data:image/jpeg;base64," + android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    @PluginMethod
    public void importPicked(PluginCall call) {
        JSArray ids = call.getArray("ids");
        if (ids == null) {
            call.reject("no-ids");
            return;
        }
        io.execute(() -> {
            try {
                List<String> list = ids.toList();
                JSArray out = new JSArray();
                for (String id : list) {
                    Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Long.parseLong(id));
                    String name = "i" + System.currentTimeMillis() + "-" + id + ".jpg";
                    File dst = new File(photoDir(), name);
                    try (InputStream in = getContext().getContentResolver().openInputStream(uri);
                         OutputStream os = new FileOutputStream(dst)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while (in != null && (n = in.read(buf)) > 0) os.write(buf, 0, n);
                    }
                    android.graphics.BitmapFactory.Options opt = new android.graphics.BitmapFactory.Options();
                    opt.inJustDecodeBounds = true;
                    android.graphics.BitmapFactory.decodeFile(dst.getAbsolutePath(), opt);
                    JSObject o = new JSObject();
                    o.put("path", DIR + "/" + name);
                    o.put("uri", Uri.fromFile(dst).toString());
                    o.put("width", opt.outWidth);
                    o.put("height", opt.outHeight);
                    out.put(o);
                }
                JSObject res = new JSObject();
                res.put("items", out);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    /* ---------------- 文件 ---------------- */

    /** 相对路径转 WebView 能加载的地址 */
    @PluginMethod
    public void resolve(PluginCall call) {
        String path = call.getString("path", "");
        File f = new File(getContext().getFilesDir(), path);
        JSObject o = new JSObject();
        o.put("uri", f.exists() ? Uri.fromFile(f).toString() : "");
        call.resolve(o);
    }

    @PluginMethod
    public void deleteFiles(PluginCall call) {
        JSArray paths = call.getArray("paths");
        if (paths == null) {
            call.resolve();
            return;
        }
        io.execute(() -> {
            try {
                for (String p : paths.<String>toList()) {
                    File f = new File(getContext().getFilesDir(), p);
                    if (f.exists()) f.delete();
                }
            } catch (Exception ignored) {
            }
            call.resolve();
        });
    }
}
