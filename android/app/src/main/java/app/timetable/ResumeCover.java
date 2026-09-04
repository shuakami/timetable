package app.timetable;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.ImageView;

/**
 * 切后台前把 WebView 当前像素拷一份盖在上面，回前台后等 WebView 真正画出新一帧再撤。
 * <p>
 * WebView 在后台会释放合成器资源，回来第一帧常是底色，会闪一下（cordova-android#1282）。
 * 做法和相机 freeze 一样：像素定格 → 内容就绪（postVisualStateCallback）→ 下一帧撤掉。
 */
final class ResumeCover {
    private static final long FALLBACK_MS = 800;

    private final Activity act;
    private final WebView webView;
    private final Handler main = new Handler(Looper.getMainLooper());
    private ImageView cover;
    private boolean paused = false;
    private long seq = 0;

    ResumeCover(Activity act, WebView webView) {
        this.act = act;
        this.webView = webView;
    }

    /** onPause：抓当前帧。异步拷贝，拷完若还在后台就盖上。 */
    void capture() {
        paused = true;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        int w = webView.getWidth(), h = webView.getHeight();
        if (w <= 0 || h <= 0 || cover != null) return;
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        Rect src = new Rect(loc[0], loc[1], loc[0] + w, loc[1] + h);
        final Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        try {
            PixelCopy.request(act.getWindow(), src, bmp, result -> {
                if (result != PixelCopy.SUCCESS || !paused || cover != null || act.isFinishing()) {
                    bmp.recycle();
                    return;
                }
                ViewGroup parent = (ViewGroup) webView.getParent();
                if (parent == null) { bmp.recycle(); return; }
                ImageView iv = new ImageView(act);
                iv.setScaleType(ImageView.ScaleType.FIT_XY);
                iv.setImageBitmap(bmp);
                iv.setClickable(false);
                iv.setFocusable(false);
                ViewGroup.LayoutParams lp = new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
                parent.addView(iv, lp);
                cover = iv;
            }, main);
        } catch (IllegalArgumentException ignored) {
            bmp.recycle();
        }
    }

    /** onResume：等 WebView 报告新内容可画，再过一帧撤掉定格；兜底超时。 */
    void release() {
        paused = false;
        if (cover == null) return;
        final long id = ++seq;
        final Runnable remove = () -> { if (id == seq) removeCover(); };
        webView.postVisualStateCallback(id, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long requestId) {
                if (requestId != id) return;
                webView.postOnAnimation(() -> webView.postOnAnimation(remove));
            }
        });
        main.postDelayed(remove, FALLBACK_MS);
    }

    private void removeCover() {
        ImageView iv = cover;
        cover = null;
        if (iv == null) return;
        ViewGroup p = (ViewGroup) iv.getParent();
        if (p != null) p.removeView(iv);
        iv.setImageDrawable(null);
    }
}
