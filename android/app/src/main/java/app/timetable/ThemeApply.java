package app.timetable;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/** 把页面主题同步到原生窗口：底色、系统栏颜色与图标深浅。 */
public final class ThemeApply {
    private static final String PREFS = "tt.theme";

    private ThemeApply() {}

    public static boolean isSystemDark(Configuration cfg) {
        return (cfg.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    public static boolean isSystemDark(Context ctx) {
        return isSystemDark(ctx.getResources().getConfiguration());
    }

    public static void remember(Context ctx, int color, boolean light) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("bg", color).putBoolean("light", light).apply();
    }

    /** 启动时先按上次的主题铺好，等页面首帧前不露出默认白底 */
    public static void applySaved(Activity act, View webView) {
        SharedPreferences sp = act.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!sp.contains("bg")) return;
        apply(act, webView, sp.getInt("bg", 0xFFF7F7F6), sp.getBoolean("light", true));
    }

    public static void apply(Activity act, View webView, int color, boolean light) {
        Window w = act.getWindow();
        w.setBackgroundDrawable(new ColorDrawable(color));
        w.setStatusBarColor(color);
        w.setNavigationBarColor(color);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        c.setAppearanceLightStatusBars(light);
        c.setAppearanceLightNavigationBars(light);
        if (webView != null) webView.setBackgroundColor(color);
    }
}
