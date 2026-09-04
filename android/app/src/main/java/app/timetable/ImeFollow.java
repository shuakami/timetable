package app.timetable;

import android.app.Activity;
import android.view.View;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;

import java.util.List;
import java.util.Locale;

/**
 * 键盘跟随，照 Android 官方 WindowInsetsAnimation 示例的两段做法：
 * <ul>
 *   <li>RootViewDeferringInsetsCallback：键盘弹出的动画期间，把 ime 内边距从往下分发的 insets 里摘掉，
 *       下游（Capacitor SystemBars）就不会在动画第一帧把 WebView 一下压短；动画结束再把最后一次 insets 重新分发，
 *       WebView 这时才缩到最终高度。</li>
 *   <li>TranslateDeferringInsetsAnimationCallback：onProgress 里逐帧把键盘露出的高度喂给页面，
 *       页面按它平移，和系统键盘动画同步；WebView 缩短那一帧页面再把平移归零（见 src/app/ime.ts）。</li>
 * </ul>
 * 收起不延迟：WebView 内容画不到自己边界之外，收起时得先把 WebView 放回全高，页面再跟着键盘往下走。
 */
final class ImeFollow {
    private final WebView webView;
    private final View parent;
    private final float density;
    /** 键盘收起时 WebView 距窗口底部的内边距（导航栏或 0），键盘高度要扣掉它 */
    private int basePad = 0;
    private boolean animating = false;
    /** 弹出动画进行中：往下分发的 insets 先摘掉 ime，动画完再补发 */
    private boolean deferring = false;
    private WindowInsetsCompat lastInsets;
    private int lastSent = -1;

    private ImeFollow(WebView webView) {
        this.webView = webView;
        this.parent = (View) webView.getParent();
        this.density = webView.getResources().getDisplayMetrics().density;
    }

    static ImeFollow install(Activity act, WebView webView) {
        ImeFollow f = new ImeFollow(webView);
        View content = act.getWindow().getDecorView().findViewById(android.R.id.content);

        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            f.lastInsets = insets;
            boolean visible = insets.isVisible(WindowInsetsCompat.Type.ime());
            int ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            WindowInsetsCompat pass = insets;
            if (f.deferring && visible) {
                pass = new WindowInsetsCompat.Builder(insets)
                        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                        .setVisible(WindowInsetsCompat.Type.ime(), false)
                        .build();
            }
            // 子视图（Capacitor SystemBars）在这次分发里才会改 padding，等分发完再读
            v.post(() -> {
                if (!visible) f.basePad = f.parent.getPaddingBottom();
                if (!f.animating) f.send(visible ? ime : 0);
            });
            return ViewCompat.onApplyWindowInsets(v, pass);
        });

        ViewCompat.setWindowInsetsAnimationCallback(content, new WindowInsetsAnimationCompat.Callback(
                WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            @Override
            public void onPrepare(@NonNull WindowInsetsAnimationCompat animation) {
                if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0) return;
                // onPrepare 时 root insets 还是旧状态：键盘此刻不可见 ⇒ 这是一次弹出
                WindowInsetsCompat now = ViewCompat.getRootWindowInsets(content);
                boolean showing = now == null || !now.isVisible(WindowInsetsCompat.Type.ime());
                if (showing) f.basePad = f.parent.getPaddingBottom();
                f.animating = true;
                f.deferring = showing;
            }

            @NonNull
            @Override
            public WindowInsetsCompat onProgress(@NonNull WindowInsetsCompat insets, @NonNull List<WindowInsetsAnimationCompat> running) {
                for (WindowInsetsAnimationCompat a : running) {
                    if ((a.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) {
                        f.send(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom);
                        break;
                    }
                }
                return insets;
            }

            @Override
            public void onEnd(@NonNull WindowInsetsAnimationCompat animation) {
                if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0) return;
                boolean wasDeferring = f.deferring;
                f.deferring = false;
                f.animating = false;
                WindowInsetsCompat now = ViewCompat.getRootWindowInsets(content);
                if (now != null) {
                    boolean visible = now.isVisible(WindowInsetsCompat.Type.ime());
                    if (!visible) f.basePad = f.parent.getPaddingBottom();
                    f.send(visible ? now.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0);
                }
                // 弹出动画结束：把压着没发的 insets 重新分发，WebView 这一帧才缩到键盘之上
                if (wasDeferring && f.lastInsets != null) ViewCompat.dispatchApplyWindowInsets(content, f.lastInsets);
            }
        });
        return f;
    }

    /** imePx：键盘当前占屏幕底部的像素；页面收到的是扣掉 basePad 后的 CSS px */
    private void send(int imePx) {
        int kb = Math.max(0, imePx - basePad);
        if (kb == lastSent) return;
        lastSent = kb;
        String js = String.format(Locale.US, "window.__ttIme&&window.__ttIme(%.2f)", kb / density);
        webView.evaluateJavascript(js, null);
    }
}
