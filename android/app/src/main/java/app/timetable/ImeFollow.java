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
 * 键盘高度逐帧喂给页面。
 * <p>
 * 照 Android 官方 WindowInsetsAnimation 示例（TranslateDeferringInsetsAnimationCallback）与
 * Capacitor Keyboard 插件的做法：在 DecorView 上挂 WindowInsetsAnimationCompat.Callback，
 * onProgress 里读 ime 内边距；再在 android.R.id.content 上挂 OnApplyWindowInsetsListener，
 * 兜住没有动画的那次变化（切后台、切输入法）。页面侧拿到的是「键盘露出 WebView 底边多少 CSS px」，
 * 直接写进 transform，就和系统键盘动画同步。
 */
final class ImeFollow {
    private final WebView webView;
    private final View parent;
    private final float density;
    /** 键盘收起时 WebView 距窗口底部的内边距（导航栏或 0），键盘高度要扣掉它 */
    private int basePad = 0;
    private boolean animating = false;
    private int lastSent = -1;

    private ImeFollow(WebView webView) {
        this.webView = webView;
        this.parent = (View) webView.getParent();
        this.density = webView.getResources().getDisplayMetrics().density;
    }

    static ImeFollow install(Activity act, WebView webView) {
        ImeFollow f = new ImeFollow(webView);
        View content = act.getWindow().getDecorView().findViewById(android.R.id.content);
        View root = content.getRootView();

        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            boolean visible = insets.isVisible(WindowInsetsCompat.Type.ime());
            int ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            // 子视图（Capacitor SystemBars）在这次分发里才会改 padding，等分发完再读
            v.post(() -> {
                if (!visible) f.basePad = f.parent.getPaddingBottom();
                if (!f.animating) f.send(visible ? ime : 0);
            });
            return ViewCompat.onApplyWindowInsets(v, insets);
        });

        ViewCompat.setWindowInsetsAnimationCallback(root, new WindowInsetsAnimationCompat.Callback(
                WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            @Override
            public void onPrepare(@NonNull WindowInsetsAnimationCompat animation) {
                if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0) return;
                WindowInsetsCompat now = ViewCompat.getRootWindowInsets(root);
                if (now != null && !now.isVisible(WindowInsetsCompat.Type.ime())) f.basePad = f.parent.getPaddingBottom();
                f.animating = true;
            }

            @NonNull
            @Override
            public WindowInsetsCompat onProgress(@NonNull WindowInsetsCompat insets, @NonNull List<WindowInsetsAnimationCompat> running) {
                boolean ime = false;
                for (WindowInsetsAnimationCompat a : running) {
                    if ((a.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) { ime = true; break; }
                }
                if (ime) f.send(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom);
                return insets;
            }

            @Override
            public void onEnd(@NonNull WindowInsetsAnimationCompat animation) {
                if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0) return;
                f.animating = false;
                WindowInsetsCompat now = ViewCompat.getRootWindowInsets(root);
                if (now == null) return;
                boolean visible = now.isVisible(WindowInsetsCompat.Type.ime());
                Insets i = now.getInsets(WindowInsetsCompat.Type.ime());
                if (!visible) f.basePad = f.parent.getPaddingBottom();
                f.send(visible ? i.bottom : 0);
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
