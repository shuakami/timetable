package app.timetable;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.os.Parcelable;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 课表文件进出：
 * - share：把 .ics 文本写进缓存目录，经 FileProvider 交给系统分享面板
 * - 收到 .ics（ACTION_VIEW / ACTION_SEND）：读出文本，页面在就推给页面，不在就先存着等页面来取
 */
@CapacitorPlugin(name = "TtFiles")
public class TtFiles extends Plugin {

    /** 收到的文件最多读这么大（课表用不到更大） */
    private static final int MAX_BYTES = 4 * 1024 * 1024;

    private static volatile TtFiles instance;
    private static volatile JSObject pending;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text", "");
        String name = call.getString("name", "timetable.ics");
        String mime = call.getString("mime", "text/calendar");
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("mkdir failed");
                return;
            }
            File[] olds = dir.listFiles();
            if (olds != null) for (File old : olds) old.delete();
            File f = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", " ").trim());
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, f.getName());
            send.setClipData(android.content.ClipData.newRawUri(f.getName(), uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, null));
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    /** 页面启动后来取：启动时就带着文件进来的那一次 */
    @PluginMethod
    public void takeIncoming(PluginCall call) {
        JSObject p = pending;
        pending = null;
        call.resolve(p != null ? p : new JSObject());
    }

    /** MainActivity 在 onCreate / onNewIntent 里调用 */
    public static void handleIntent(Activity act, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (p instanceof Uri) uri = (Uri) p;
        }
        if (uri == null) return;
        String scheme = uri.getScheme();
        if (!"content".equals(scheme) && !"file".equals(scheme)) return;
        // 同一个 Intent 被 resume 再送一次时不重复处理
        intent.setData(null);
        intent.removeExtra(Intent.EXTRA_STREAM);

        String text = readText(act.getContentResolver(), uri);
        if (text == null) return;
        JSObject o = new JSObject();
        o.put("text", text);
        o.put("name", uri.getLastPathSegment() == null ? "" : uri.getLastPathSegment());
        TtFiles p = instance;
        if (p != null && p.hasListeners("incoming")) {
            act.runOnUiThread(() -> p.notifyListeners("incoming", o));
        } else {
            pending = o;
        }
    }

    private static String readText(ContentResolver cr, Uri uri) {
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            int n;
            while ((n = in.read(chunk)) > 0) {
                buf.write(chunk, 0, n);
                if (buf.size() > MAX_BYTES) return null;
            }
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
