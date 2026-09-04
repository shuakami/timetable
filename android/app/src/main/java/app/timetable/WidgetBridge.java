package app.timetable;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.appwidget.AppWidgetManager;
import android.graphics.Color;
import android.content.ComponentName;
import android.os.Build;
import android.widget.Toast;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import app.timetable.widget.BaseWidget;
import app.timetable.widget.NextWidget;
import app.timetable.widget.TodayWidget;
import app.timetable.widget.TwoDaysWidget;
import app.timetable.widget.WeekWidget;
import app.timetable.widget.WidgetStore;

/** WebView 与桌面小组件之间的桥：写快照、触发重画、请求添加到桌面。 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridge extends Plugin {

    /** 页面首帧已画完：系统开屏可以收走 */
    public static volatile boolean webReady = false;

    private static volatile WidgetBridge instance;

    @Override
    public void load() {
        instance = this;
    }

    /** 系统深浅色：页面启动时主动问一次，不依赖 WebView 的 prefers-color-scheme */
    @PluginMethod
    public void systemDark(PluginCall call) {
        JSObject o = new JSObject();
        o.put("dark", ThemeApply.isSystemDark(getContext()));
        call.resolve(o);
    }

    public static void notifySystemDark(Activity act, boolean dark) {
        WidgetBridge p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("dark", dark);
        act.runOnUiThread(() -> p.notifyListeners("systemDark", o));
    }

    /**
     * 系统对话框主题：DeviceDefault 由 ROM 厂商覆写（ColorOS / MIUI / One UI / Pixel 动态取色），
     * AppCompat/Material 只会得到 AOSP 原生样式。
     */
    private static int dialogTheme(Activity act) {
        return ThemeApply.isSystemDark(act)
            ? android.R.style.Theme_DeviceDefault_Dialog_Alert
            : android.R.style.Theme_DeviceDefault_Light_Dialog_Alert;
    }

    /** 返回键只关对话框，不往 Activity 下传 */
    private static void eatBack(android.app.Dialog d) {
        d.setOnKeyListener((dlg, keyCode, event) -> {
            if (keyCode != android.view.KeyEvent.KEYCODE_BACK) return false;
            if (event.getAction() == android.view.KeyEvent.ACTION_UP) dlg.cancel();
            return true;
        });
    }

    /** 系统日期选择对话框：入参/出参都是 yyyy-MM-dd，取消时 value 为空 */
    @PluginMethod
    public void pickDate(PluginCall call) {
        Activity act = getActivity();
        if (act == null) { call.reject("no activity"); return; }
        String v = call.getString("value", "");
        java.util.Calendar c = java.util.Calendar.getInstance();
        if (v != null && v.length() == 10) {
            try {
                c.set(Integer.parseInt(v.substring(0, 4)), Integer.parseInt(v.substring(5, 7)) - 1, Integer.parseInt(v.substring(8, 10)));
            } catch (NumberFormatException ignored) {}
        }
        act.runOnUiThread(() -> {
            DatePickerDialog d = new DatePickerDialog(act, dialogTheme(act), (view, y, m, day) -> {
                JSObject o = new JSObject();
                o.put("value", String.format(java.util.Locale.ROOT, "%04d-%02d-%02d", y, m + 1, day));
                call.resolve(o);
            }, c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH), c.get(java.util.Calendar.DAY_OF_MONTH));
            d.setOnCancelListener(x -> call.resolve(new JSObject().put("value", "")));
            eatBack(d);
            d.show();
        });
    }

    /** 系统时间选择对话框：HH:mm */
    @PluginMethod
    public void pickTime(PluginCall call) {
        Activity act = getActivity();
        if (act == null) { call.reject("no activity"); return; }
        String v = call.getString("value", "");
        int h = 8, m = 0;
        if (v != null && v.length() == 5) {
            try { h = Integer.parseInt(v.substring(0, 2)); m = Integer.parseInt(v.substring(3, 5)); } catch (NumberFormatException ignored) {}
        }
        final int hh = h, mm = m;
        act.runOnUiThread(() -> {
            TimePickerDialog d = new TimePickerDialog(act, dialogTheme(act), (view, hour, minute) -> {
                JSObject o = new JSObject();
                o.put("value", String.format(java.util.Locale.ROOT, "%02d:%02d", hour, minute));
                call.resolve(o);
            }, hh, mm, true);
            d.setOnCancelListener(x -> call.resolve(new JSObject().put("value", "")));
            eatBack(d);
            d.show();
        });
    }

    /** 系统单选列表：返回选中下标，取消为 -1 */
    @PluginMethod
    public void pickOption(PluginCall call) {
        Activity act = getActivity();
        JSArray arr = call.getArray("options");
        if (act == null || arr == null) { call.reject("bad args"); return; }
        String title = call.getString("title");
        int selected = call.getInt("selected", -1);
        CharSequence[] items;
        try {
            java.util.List<String> list = arr.toList();
            items = list.toArray(new CharSequence[0]);
        } catch (org.json.JSONException e) { call.reject("bad options"); return; }
        act.runOnUiThread(() -> {
            AlertDialog.Builder b = new AlertDialog.Builder(act, dialogTheme(act));
            if (title != null) b.setTitle(title);
            b.setSingleChoiceItems(items, selected, (dlg, which) -> {
                call.resolve(new JSObject().put("index", which));
                dlg.dismiss();
            });
            b.setOnCancelListener(x -> call.resolve(new JSObject().put("index", -1)));
            AlertDialog d = b.create();
            eatBack(d);
            d.show();
        });
    }

    @PluginMethod
    public void toast(PluginCall call) {
        String text = call.getString("text");
        Activity act = getActivity();
        if (text != null && act != null) act.runOnUiThread(() -> Toast.makeText(act, text, Toast.LENGTH_SHORT).show());
        call.resolve();
    }

    @PluginMethod
    public void ready(PluginCall call) {
        webReady = true;
        call.resolve();
    }

    /** 页面主题变化：窗口底色、状态栏/导航栏颜色与图标深浅、WebView 底色一起切，避免露白边 */
    @PluginMethod
    public void setTheme(PluginCall call) {
        String bg = call.getString("bg");
        Boolean light = call.getBoolean("light");
        if (bg == null || light == null) {
            call.reject("missing bg/light");
            return;
        }
        int color;
        try {
            color = Color.parseColor(bg);
        } catch (IllegalArgumentException e) {
            call.reject("bad color");
            return;
        }
        ThemeApply.remember(getContext(), color, light);
        Activity act = getActivity();
        if (act != null) act.runOnUiThread(() -> ThemeApply.apply(act, getBridge().getWebView(), color, light));
        call.resolve();
    }

    @PluginMethod
    public void setData(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("missing json");
            return;
        }
        WidgetStore.write(getContext(), json);
        BaseWidget.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void isPinSupported(PluginCall call) {
        JSObject res = new JSObject();
        res.put("supported", supported());
        call.resolve(res);
    }

    @PluginMethod
    public void requestPin(PluginCall call) {
        JSObject res = new JSObject();
        if (!supported()) {
            res.put("requested", false);
            call.resolve(res);
            return;
        }
        AppWidgetManager mgr = AppWidgetManager.getInstance(getContext());
        ComponentName cn = new ComponentName(getContext(), providerOf(call.getString("style", "today")));
        boolean ok = mgr.requestPinAppWidget(cn, null, null);
        res.put("requested", ok);
        call.resolve(res);
    }

    private boolean supported() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        AppWidgetManager mgr = AppWidgetManager.getInstance(getContext());
        return mgr != null && mgr.isRequestPinAppWidgetSupported();
    }

    private Class<?> providerOf(String style) {
        if (style == null) return TodayWidget.class;
        switch (style) {
            case "next": return NextWidget.class;
            case "twoDays": return TwoDaysWidget.class;
            case "week": return WeekWidget.class;
            default: return TodayWidget.class;
        }
    }
}
