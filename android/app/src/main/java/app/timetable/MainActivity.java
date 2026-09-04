package app.timetable;

import android.content.res.Configuration;
import android.os.Bundle;
import android.os.SystemClock;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** 开屏最多停留多久：页面迟迟不报首帧时也要放行 */
    private static final long SPLASH_MAX_MS = 4000;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 只用系统开屏（纯背景色），一直挡到 WebView 画完首帧再撤，中间不出现空白页
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        final long start = SystemClock.uptimeMillis();
        splash.setKeepOnScreenCondition(() -> !WidgetBridge.webReady && SystemClock.uptimeMillis() - start < SPLASH_MAX_MS);
        registerPlugin(WidgetBridge.class);
        super.onCreate(savedInstanceState);
        ThemeApply.applySaved(this, getBridge().getWebView());
    }

    /** uiMode 在 configChanges 里，系统深浅色切换不重建 Activity，这里把变化转给页面 */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        WidgetBridge.notifySystemDark(this, ThemeApply.isSystemDark(newConfig));
    }
}
