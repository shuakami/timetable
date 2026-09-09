package app.timetable;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.net.http.SslError;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.MotionEvent;
import android.view.PixelCopy;
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

import androidx.webkit.CustomHeader;
import androidx.webkit.Profile;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 教务导入用的内置浏览器。
 * <p>
 * 学校页面放在一个独立 WebView 里，叠在应用 WebView <b>下面</b>；应用 WebView 在这段时间透明，
 * 页面自己在中间留出一块透明区域（frame），地址栏、悬浮胶囊、选学期抽屉照常由页面画在上面。
 * 落在透明区域里的触摸（除去 keep 列出的胶囊等区域）原样转发给下面的 WebView。
 * <p>
 * 会话隔离：支持多 Profile 的系统 WebView 上每所学校一个 Profile（Cookie / 存储与应用及其他学校互不相通），
 * 默认打开与关闭都清 Cookie 与本地存储；用户开了「保持登录」才保留该 Profile（只有 Cookie，不存账号密码），
 * 「退出登录」整个删掉。不支持多 Profile 的老 WebView 退回全局 CookieManager 全清，不提供保持登录。
 * 页面里的脚本只在用户点「导入」等操作时通过 eval 注入，结果经 TtBridge.post 回传。
 * <p>
 * 自动更新用另一个不可见的 WebView（bg*）：同一 Profile 打开课表页，页面完成后由 JS 侧决定是否还在登录态并注入同一套脚本。
 * <p>
 * 请求头：WebView 会给每个请求补一个 X-Requested-With: 应用包名，没有关闭它的接口。强智等教务把带这个头的请求
 * 一律当 AJAX：未登录时不跳登录页而是直接回一段 JSON（还没有 Content-Type，页面上就是乱码）。WebView 只在请求
 * 没带该头时才补包名，所以这里给它一个空值，服务器看到的就与普通浏览器一致：支持 CUSTOM_REQUEST_HEADERS 的 WebView
 * 用 Profile 的自定义请求头覆盖该学校的全部请求；老 WebView 退回到在 shouldOverrideUrlLoading 里把主文档导航带头重发。
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
    private boolean painted = false;
    private Drawable hostBg, parentBg, windowBg;
    private float hostAlpha = 1f;
    /** 当前页面用的 Profile；null 为默认 Profile（老 WebView） */
    private String profileName;
    /** 自动更新用的不可见 WebView */
    private WebView bg;

    private static boolean multiProfile() {
        try {
            return WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
        } catch (Throwable t) {
            return false;
        }
    }

    @Override
    public void load() {
        density = getContext().getResources().getDisplayMetrics().density;
    }

    private static final String XRW = "X-Requested-With";
    /** 与 Chromium 一致的重定向上限，防止「重定向到自身」时无限重发 */
    private static final int MAX_REDIRECTS = 20;

    /** 主文档导航用的请求头；referer 为发起页（WebView 会按默认 referrer policy 裁剪） */
    private static Map<String, String> navHeaders(String referer) {
        Map<String, String> h = new HashMap<>();
        h.put(XRW, "");
        if (referer != null && (referer.startsWith("http://") || referer.startsWith("https://"))) {
            h.put("Referer", referer);
        }
        return h;
    }

    private static boolean isHttp(String scheme) {
        return "http".equals(scheme) || "https".equals(scheme);
    }

    /**
     * 给该 Profile 的所有 http(s) 请求（主文档、子框、XHR、POST）带空值 X-Requested-With；页面自己设了的不覆盖。
     * 需要 WebView 支持 CUSTOM_REQUEST_HEADERS；不支持返回 false，由 {@link NavHeaderClient} 重发主文档导航兼容。
     */
    private static boolean profileHeader(String profile) {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.CUSTOM_REQUEST_HEADERS)) return false;
            Profile p = ProfileStore.getInstance().getOrCreateProfile(profile);
            p.addCustomHeader(new CustomHeader(XRW, "", Collections.singleton("*")));
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * shouldOverrideUrlLoading 的公共处理。reissue=true（Profile 请求头不可用）时，页面发起的 http(s) 主文档 GET 导航
     * （含 POST 登录后的 302）取消掉，换成带 {@link #navHeaders} 的重发；应用自己 loadUrl 的导航 WebView 不会再回调，
     * 不会递归。非 http(s) 协议一律吞掉（不外跳）。
     */
    private static class NavHeaderClient extends WebViewClient {
        private final boolean reissue;
        /** 连续重发的重定向次数；非重定向导航或页面完成时归零 */
        private int redirects;

        NavHeaderClient(boolean reissue) {
            this.reissue = reissue;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            if (!isHttp(req.getUrl().getScheme())) return true;
            if (!reissue || !req.isForMainFrame()) return false;
            if (req.isRedirect()) {
                if (++redirects > MAX_REDIRECTS) return false;
            } else {
                redirects = 0;
            }
            view.loadUrl(req.getUrl().toString(), navHeaders(view.getUrl()));
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            redirects = 0;
        }
    }

    /* ---------------- 页面接口 ---------------- */

    /** profile：每所学校一个；keep=true 时不清上次会话（仅多 Profile 可用时生效） */
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "");
        String profile = call.getString("profile");
        boolean keep = Boolean.TRUE.equals(call.getBoolean("keep", false));
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                ensureView(profile);
                final WebView w = web;
                Runnable go = () -> {
                    if (w == web) w.loadUrl(url, navHeaders(null));
                };
                if (keep && profileName != null) go.run();
                else clearSession(go);
                JSObject o = new JSObject();
                o.put("persistent", profileName != null);
                call.resolve(o);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    /** keep=true 时保留该 Profile 的 Cookie / 存储（用户开了保持登录） */
    @PluginMethod
    public void close(PluginCall call) {
        boolean keep = Boolean.TRUE.equals(call.getBoolean("keep", false));
        getActivity().runOnUiThread(() -> {
            teardown(keep && profileName != null);
            call.resolve();
        });
    }

    @PluginMethod
    public void profiles(PluginCall call) {
        JSObject o = new JSObject();
        o.put("supported", multiProfile());
        call.resolve(o);
    }

    /** 退出登录：整个删掉该学校的 Profile；正在使用中则删不掉，ok=false */
    @PluginMethod
    public void clearProfile(PluginCall call) {
        String profile = call.getString("profile", "");
        getActivity().runOnUiThread(() -> {
            boolean ok = false;
            if (profile != null && !profile.isEmpty() && multiProfile()) {
                try {
                    ok = ProfileStore.getInstance().deleteProfile(profile);
                } catch (Exception ignored) {
                }
            }
            JSObject o = new JSObject();
            o.put("ok", ok);
            call.resolve(o);
        });
    }

    /* ---------------- 自动更新：不可见 WebView ---------------- */

    @PluginMethod
    public void bgOpen(PluginCall call) {
        String url = call.getString("url", "");
        String profile = call.getString("profile");
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                bgTeardown();
                WebView host = bridge.getWebView();
                ViewGroup parent = (ViewGroup) host.getParent();
                WebView w = new WebView(getContext());
                boolean viaProfile = false;
                if (profile != null && !profile.isEmpty() && multiProfile()) {
                    WebViewCompat.setProfile(w, profile);
                    viaProfile = profileHeader(profile);
                }
                configure(w);
                w.addJavascriptInterface(new Bridge(), "TtBridge");
                w.setWebViewClient(new BgClient(!viaProfile));
                w.setWebChromeClient(new WebChromeClient());
                w.setVisibility(View.INVISIBLE);
                DisplayMetrics dm = getContext().getResources().getDisplayMetrics();
                parent.addView(w, 0, new ViewGroup.LayoutParams(dm.widthPixels, dm.heightPixels));
                bg = w;
                w.loadUrl(url, navHeaders(null));
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void bgEval(PluginCall call) {
        String js = call.getString("js", "");
        getActivity().runOnUiThread(() -> {
            if (bg == null || js == null) {
                call.reject("closed");
                return;
            }
            bg.evaluateJavascript(js, v -> {
                JSObject o = new JSObject();
                o.put("value", v == null ? "null" : v);
                call.resolve(o);
            });
        });
    }

    @PluginMethod
    public void bgClose(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            bgTeardown();
            call.resolve();
        });
    }

    private void bgTeardown() {
        if (bg == null) return;
        WebView w = bg;
        bg = null;
        w.stopLoading();
        w.loadUrl("about:blank");
        w.removeJavascriptInterface("TtBridge");
        if (w.getParent() instanceof ViewGroup) ((ViewGroup) w.getParent()).removeView(w);
        w.destroy();
    }

    @PluginMethod
    public void navigate(PluginCall call) {
        String url = call.getString("url", "");
        getActivity().runOnUiThread(() -> {
            if (web != null && url != null && !url.isEmpty()) web.loadUrl(url, navHeaders(null));
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
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (web != null) {
                web.stopLoading();
                emit(false, 100);
            }
            call.resolve();
        });
    }

    /** 学校页面当前画面的定格（半分辨率 JPEG data URL）；页面退场时贴在透明洞里一起滑走 */
    @PluginMethod
    public void snapshot(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (web == null || web.getWidth() == 0 || web.getHeight() == 0) {
                call.reject("closed");
                return;
            }
            final WebView w = web;
            int sw = w.getWidth(), sh = w.getHeight();
            Bitmap bmp = Bitmap.createBitmap(Math.max(1, sw / 2), Math.max(1, sh / 2), Bitmap.Config.ARGB_8888);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                int[] loc = new int[2];
                w.getLocationInWindow(loc);
                Rect src = new Rect(loc[0], loc[1], loc[0] + sw, loc[1] + sh);
                try {
                    PixelCopy.request(getActivity().getWindow(), src, bmp, res -> {
                        if (res != PixelCopy.SUCCESS) drawInto(w, bmp);
                        encode(bmp, call);
                    }, new Handler(Looper.getMainLooper()));
                    return;
                } catch (Exception ignored) {
                }
            }
            drawInto(w, bmp);
            encode(bmp, call);
        });
    }

    private static void drawInto(View v, Bitmap bmp) {
        Canvas c = new Canvas(bmp);
        c.scale((float) bmp.getWidth() / Math.max(1, v.getWidth()), (float) bmp.getHeight() / Math.max(1, v.getHeight()));
        v.draw(c);
    }

    private static void encode(Bitmap bmp, PluginCall call) {
        new Thread(() -> {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 78, out);
            bmp.recycle();
            JSObject o = new JSObject();
            o.put("src", "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(o);
        }).start();
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
    private void configure(WebView w) {
        WebSettings s = w.getSettings();
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
        CookieManager cm = cookies(w);
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(w, true);
    }

    /** 该 WebView 所属 Profile 的 CookieManager；老 WebView 为全局单例 */
    private static CookieManager cookies(WebView w) {
        if (multiProfile()) {
            try {
                return WebViewCompat.getProfile(w).getCookieManager();
            } catch (Exception ignored) {
            }
        }
        return CookieManager.getInstance();
    }

    private void ensureView(String profile) {
        if (web != null) return;
        WebView host = bridge.getWebView();
        ViewGroup parent = (ViewGroup) host.getParent();
        container = new FrameLayout(getContext());
        // 页面画出首帧前，洞里露的是应用底色而不是白块
        SharedPreferences sp = getContext().getSharedPreferences("tt.theme", Context.MODE_PRIVATE);
        container.setBackgroundColor(sp.getInt("bg", 0xFFF7F7F6));
        painted = false;
        container.setVisibility(frameTop < 0 ? View.INVISIBLE : View.VISIBLE);
        container.setPadding(0, Math.max(0, frameTop), 0, Math.max(0, frameBottom));
        web = new WebView(getContext());
        profileName = null;
        boolean viaProfile = false;
        // Profile 必须在首次导航前指定
        if (profile != null && !profile.isEmpty() && multiProfile()) {
            try {
                WebViewCompat.setProfile(web, profile);
                profileName = profile;
                viaProfile = profileHeader(profile);
            } catch (Exception ignored) {
            }
        }
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        configure(web);
        web.addJavascriptInterface(new Bridge(), "TtBridge");
        web.setWebViewClient(new Client(!viaProfile));
        web.setWebChromeClient(new Chrome());
        container.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        int idx = Math.max(0, parent.indexOfChild(host));
        parent.addView(container, idx, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        host.setOnTouchListener(this::route);
        applyTransparency();
    }

    private void teardown(boolean keepSession) {
        WebView host = bridge.getWebView();
        host.setOnTouchListener(null);
        routing = false;
        restoreTransparency();
        if (web != null) {
            final WebView w = web;
            final FrameLayout c = container;
            Runnable fin = () -> {
                w.stopLoading();
                w.loadUrl("about:blank");
                w.clearHistory();
                w.clearCache(true);
                w.clearFormData();
                w.removeJavascriptInterface("TtBridge");
                if (c != null && c.getParent() instanceof ViewGroup) {
                    ((ViewGroup) c.getParent()).removeView(c);
                }
                w.destroy();
            };
            if (keepSession) {
                cookies(w).flush();
                fin.run();
            } else {
                clearSession(fin);
            }
            web = null;
            container = null;
        }
        frameTop = -1;
        keep.clear();
    }

    /**
     * 清当前 Profile 的 Cookie（老 WebView 为全局，应用自身不用 Cookie）；有页面在时先清它的本地存储。
     * then 在 Cookie 真正清完后才跑，随后的 loadUrl 不会带着旧会话发出去。
     */
    private void clearSession(Runnable then) {
        final CookieManager cm = web != null ? cookies(web) : CookieManager.getInstance();
        Runnable cookies = () -> cm.removeAllCookies(x -> {
            cm.flush();
            if (then != null) then.run();
        });
        if (web != null && web.getUrl() != null) {
            web.evaluateJavascript("try{localStorage.clear();sessionStorage.clear()}catch(e){}", v -> cookies.run());
        } else {
            cookies.run();
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
        o.put("painted", painted);
        return o;
    }

    private void emit(boolean loading, int progress) {
        notifyListeners("nav", snapshot(loading, progress));
    }

    private final class Client extends NavHeaderClient {
        Client(boolean reissue) {
            super(reissue);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            emit(true, 0);
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (painted) return;
            painted = true;
            emit(view.getProgress() < 100, view.getProgress());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            painted = true;
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

    /** 不可见 WebView 的导航：只报主文档完成 / 失败，登录态由 JS 侧按地址与标题判断 */
    private final class BgClient extends NavHeaderClient {
        BgClient(boolean reissue) {
            super(reissue);
        }

        private void report(WebView view, String error) {
            if (view != bg) return;
            JSObject o = new JSObject();
            String url = view.getUrl();
            String title = view.getTitle();
            o.put("url", url == null ? "" : url);
            o.put("title", title == null ? "" : title);
            if (error != null) o.put("error", error);
            notifyListeners("bgNav", o);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            report(view, null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) report(view, String.valueOf(err.getDescription()));
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            report(view, "ssl");
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int p) {
            emit(p < 100, p);
        }

        @Override
        public void onReceivedTitle(WebView view, String title) {
            emit(view.getProgress() < 100, view.getProgress());
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
