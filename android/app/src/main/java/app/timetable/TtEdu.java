package app.timetable;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.net.http.SslError;
import android.os.Build;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 教务导入用的内置浏览器。
 * <p>
 * 学校页面放在一个独立 WebView 里，叠在应用 WebView <b>下面</b>；应用 WebView 在这段时间透明，
 * 页面自己在中间留出一块透明区域（frame），地址栏、悬浮胶囊、选学期抽屉照常由页面画在上面。
 * 落在透明区域里的触摸（除去 keep 列出的胶囊等区域）原样转发给下面的 WebView。
 * <p>
 * 会话隔离：打开与关闭都清 Cookie，关闭时顺带清掉该站的 localStorage / sessionStorage 与缓存，
 * 账号信息不落盘；应用自己的 WebView 用 localStorage / SQLite，不走 Cookie，不受影响。
 * 页面里的脚本只在用户点「导入」等操作时通过 eval 注入，结果经 TtBridge.post 回传。
 */
@CapacitorPlugin(name = "TtEdu")
public class TtEdu extends Plugin {

    private FrameLayout container;
    private WebView web;
    private float density = 1f;
    /** 透明区域（设备像素，相对 WebView 顶/底） */
    private int frameTop = -1, frameBottom = 0;
    private final List<int[]> keep = new ArrayList<>();
    private boolean interactive = true;
    private boolean routing = false;
    private boolean transparent = false;
    private Drawable hostBg, parentBg, windowBg;
    private float hostAlpha = 1f;

    @Override
    public void load() {
        density = getContext().getResources().getDisplayMetrics().density;
    }

    /* ---------------- 页面接口 ---------------- */

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                ensureView();
                clearSession(null);
                web.loadUrl(url);
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            teardown();
            call.resolve();
        });
    }

    @PluginMethod
    public void navigate(PluginCall call) {
        String url = call.getString("url", "");
        getActivity().runOnUiThread(() -> {
            if (web != null && url != null && !url.isEmpty()) web.loadUrl(url);
            call.resolve();
        });
    }

    @PluginMethod
    public void reload(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (web != null) web.reload();
            call.resolve();
        });
    }

    @PluginMethod
    public void back(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            boolean went = web != null && web.canGoBack();
            if (went) web.goBack();
            JSObject o = new JSObject();
            o.put("went", went);
            call.resolve(o);
        });
    }

    /** 透明区域与其中保留给页面自己的矩形，单位 CSS px；interactive=false 时触摸一律留在页面（抽屉打开时） */
    @PluginMethod
    public void frame(PluginCall call) {
        double top = call.getDouble("top", -1d);
        double bottom = call.getDouble("bottom", 0d);
        boolean inter = Boolean.TRUE.equals(call.getBoolean("interactive", true));
        JSArray arr = call.getArray("keep");
        List<int[]> rects = new ArrayList<>();
        if (arr != null) {
            try {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject r = arr.getJSONObject(i);
                    rects.add(new int[]{
                            px(r.optDouble("x", 0)), px(r.optDouble("y", 0)),
                            px(r.optDouble("x", 0) + r.optDouble("w", 0)), px(r.optDouble("y", 0) + r.optDouble("h", 0))});
                }
            } catch (Exception ignored) {
            }
        }
        getActivity().runOnUiThread(() -> {
            frameTop = top < 0 ? -1 : px(top);
            frameBottom = px(bottom);
            keep.clear();
            keep.addAll(rects);
            interactive = inter;
            if (container != null) {
                container.setPadding(0, Math.max(0, frameTop), 0, Math.max(0, frameBottom));
                container.setVisibility(frameTop < 0 ? View.INVISIBLE : View.VISIBLE);
            }
            applyTransparency();
            call.resolve();
        });
    }

    /** 在学校页面里执行脚本；同步返回值以 JSON 字符串给回，异步结果走 TtBridge.post → message 事件 */
    @PluginMethod
    public void eval(PluginCall call) {
        String js = call.getString("js", "");
        getActivity().runOnUiThread(() -> {
            if (web == null || js == null) {
                call.reject("closed");
                return;
            }
            web.evaluateJavascript(js, v -> {
                JSObject o = new JSObject();
                o.put("value", v == null ? "null" : v);
                call.resolve(o);
            });
        });
    }

    @PluginMethod
    public void state(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(snapshot(false, 100)));
    }

    /* ---------------- 视图 ---------------- */

    @SuppressLint("SetJavaScriptEnabled")
    private void ensureView() {
        if (web != null) return;
        WebView host = bridge.getWebView();
        ViewGroup parent = (ViewGroup) host.getParent();
        container = new FrameLayout(getContext());
        container.setBackgroundColor(Color.WHITE);
        container.setVisibility(frameTop < 0 ? View.INVISIBLE : View.VISIBLE);
        container.setPadding(0, Math.max(0, frameTop), 0, Math.max(0, frameBottom));
        web = new WebView(getContext());
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSaveFormData(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "TtBridge");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        container.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        int idx = Math.max(0, parent.indexOfChild(host));
        parent.addView(container, idx, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        host.setOnTouchListener(this::route);
        applyTransparency();
    }

    private void teardown() {
        WebView host = bridge.getWebView();
        host.setOnTouchListener(null);
        routing = false;
        restoreTransparency();
        if (web != null) {
            final WebView w = web;
            clearSession(() -> {
                w.stopLoading();
                w.loadUrl("about:blank");
                w.clearHistory();
                w.clearCache(true);
                w.clearFormData();
                w.removeJavascriptInterface("TtBridge");
                if (container != null && container.getParent() instanceof ViewGroup) {
                    ((ViewGroup) container.getParent()).removeView(container);
                }
                w.destroy();
            });
            web = null;
            container = null;
        }
        frameTop = -1;
        keep.clear();
    }

    /** Cookie 全清（应用自身不用 Cookie）；有页面在时先清它的本地存储 */
    private void clearSession(Runnable then) {
        if (web != null) {
            web.evaluateJavascript("try{localStorage.clear();sessionStorage.clear()}catch(e){}", v -> {
                CookieManager cm = CookieManager.getInstance();
                cm.removeAllCookies(x -> cm.flush());
                if (then != null) then.run();
            });
        } else {
            CookieManager cm = CookieManager.getInstance();
            cm.removeAllCookies(x -> cm.flush());
            if (then != null) then.run();
        }
    }

    /* ---------------- 应用 WebView 透明（下面的学校页面才看得见） ---------------- */

    private static boolean miui() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.US);
        String b = Build.BRAND == null ? "" : Build.BRAND.toLowerCase(Locale.US);
        return m.contains("xiaomi") || b.contains("xiaomi") || b.contains("redmi") || b.contains("poco");
    }

    private static boolean fullStack() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.US);
        String b = Build.BRAND == null ? "" : Build.BRAND.toLowerCase(Locale.US);
        return miui() || m.contains("huawei") || m.contains("honor") || b.contains("huawei") || b.contains("honor");
    }

    private void applyTransparency() {
        if (web == null) return;
        WebView host = bridge.getWebView();
        View parent = (View) host.getParent();
        Window win = getActivity().getWindow();
        if (!transparent) {
            hostBg = host.getBackground();
            hostAlpha = host.getAlpha();
            parentBg = parent == null ? null : parent.getBackground();
            windowBg = win.getDecorView().getBackground();
            transparent = true;
        }
        // 小米 / 华为系的合成器会把全透明 WebView 优化掉，留 1/255 的 alpha（做法同 capacitor-inappbrowser）
        if (fullStack()) {
            win.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            if (parent != null) parent.setBackgroundColor(Color.TRANSPARENT);
        }
        host.setBackgroundColor(miui() ? Color.argb(1, 255, 255, 255) : Color.TRANSPARENT);
        host.setAlpha(miui() ? 0.99f : hostAlpha);
    }

    private void restoreTransparency() {
        if (!transparent) return;
        transparent = false;
        WebView host = bridge.getWebView();
        View parent = (View) host.getParent();
        host.setBackground(hostBg);
        host.setAlpha(hostAlpha);
        if (parent != null) parent.setBackground(parentBg);
        getActivity().getWindow().setBackgroundDrawable(windowBg);
        ThemeApply.applySaved(getActivity(), host);
    }

    /* ---------------- 触摸转发 ---------------- */

    private boolean inHole(float x, float y) {
        if (!interactive || frameTop < 0 || web == null) return false;
        int h = bridge.getWebView().getHeight();
        if (y < frameTop || y > h - frameBottom) return false;
        for (int[] r : keep) {
            if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return false;
        }
        return true;
    }

    /** 应用 WebView 的触摸：按下落在透明区域就把整段手势交给下面的页面 */
    private boolean route(View v, MotionEvent ev) {
        int a = ev.getActionMasked();
        if (a == MotionEvent.ACTION_DOWN) routing = inHole(ev.getX(), ev.getY());
        if (!routing || web == null) return false;
        MotionEvent copy = MotionEvent.obtain(ev);
        copy.offsetLocation(0, -Math.max(0, frameTop));
        web.dispatchTouchEvent(copy);
        copy.recycle();
        if (a == MotionEvent.ACTION_UP || a == MotionEvent.ACTION_CANCEL) routing = false;
        return true;
    }

    /* ---------------- 事件 ---------------- */

    private int px(double css) {
        return (int) Math.round(css * density);
    }

    private JSObject snapshot(boolean loading, int progress) {
        JSObject o = new JSObject();
        String url = web == null ? null : web.getUrl();
        String title = web == null ? null : web.getTitle();
        o.put("url", url == null ? "" : url);
        o.put("title", title == null ? "" : title);
        o.put("loading", loading);
        o.put("progress", progress);
        o.put("canGoBack", web != null && web.canGoBack());
        return o;
    }

    private void emit(boolean loading, int progress) {
        notifyListeners("nav", snapshot(loading, progress));
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            String scheme = req.getUrl().getScheme();
            return !("http".equals(scheme) || "https".equals(scheme));
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            emit(true, 0);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            emit(false, 100);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            JSObject o = snapshot(false, 100);
            o.put("error", String.valueOf(err.getDescription()));
            notifyListeners("nav", o);
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            JSObject o = snapshot(false, 100);
            o.put("error", "ssl");
            notifyListeners("nav", o);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int p) {
            emit(p < 100, p);
        }

        @Override
        public void onReceivedTitle(WebView view, String title) {
            emit(false, 100);
        }
    }

    private final class Bridge {
        @JavascriptInterface
        public void post(String data) {
            JSObject o = new JSObject();
            o.put("data", data == null ? "" : data);
            notifyListeners("message", o);
        }
    }
}
