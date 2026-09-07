package app.timetable;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.appwidget.AppWidgetManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.view.View;
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

    /** Material You 主色调板（Android 12+），tone 100 → 0 共 13 级 */
    private static final int[] ACCENT1 = {
        android.R.color.system_accent1_0, android.R.color.system_accent1_10, android.R.color.system_accent1_50,
        android.R.color.system_accent1_100, android.R.color.system_accent1_200, android.R.color.system_accent1_300,
        android.R.color.system_accent1_400, android.R.color.system_accent1_500, android.R.color.system_accent1_600,
        android.R.color.system_accent1_700, android.R.color.system_accent1_800, android.R.color.system_accent1_900,
        android.R.color.system_accent1_1000,
    };

    private static JSObject dynamicColorsJson(android.content.Context ctx) {
        JSObject o = new JSObject();
        boolean ok = Build.VERSION.SDK_INT >= 31;
        o.put("supported", ok);
        if (!ok) return o;
        JSArray accent = new JSArray();
        for (int id : ACCENT1) accent.put(String.format("#%06X", 0xFFFFFF & ctx.getColor(id)));
        o.put("accent", accent);
        return o;
    }

    @PluginMethod
    public void dynamicColors(PluginCall call) {
        call.resolve(dynamicColorsJson(getContext()));
    }

    /** 壁纸换色后系统色板会变：回前台时再推一次，页面自己比对 */
    public static void notifyDynamicColors(Activity act) {
        WidgetBridge p = instance;
        if (p == null || Build.VERSION.SDK_INT < 31) return;
        JSObject o = dynamicColorsJson(act);
        act.runOnUiThread(() -> p.notifyListeners("dynamicColors", o));
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
        d.setCanceledOnTouchOutside(true);
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

    /** 系统确认框：确定为 true，取消 / 点外部 / 返回为 false */
    @PluginMethod
    public void confirm(PluginCall call) {
        Activity act = getActivity();
        if (act == null) { call.reject("no activity"); return; }
        String title = call.getString("title");
        String message = call.getString("message");
        String ok = call.getString("ok", "确定");
        String cancel = call.getString("cancel", "取消");
        act.runOnUiThread(() -> {
            AlertDialog.Builder b = new AlertDialog.Builder(act, dialogTheme(act));
            if (title != null) b.setTitle(title);
            if (message != null) b.setMessage(message);
            b.setPositiveButton(ok, (dlg, w) -> call.resolve(new JSObject().put("ok", true)));
            b.setNegativeButton(cancel, (dlg, w) -> call.resolve(new JSObject().put("ok", false)));
            b.setOnCancelListener(x -> call.resolve(new JSObject().put("ok", false)));
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

    /* ---------------- 剪贴板：WebView 里 navigator.clipboard 读不到、写不稳，走系统 ClipboardManager ---------------- */

    @PluginMethod
    public void copy(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("missing text");
            return;
        }
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        act.runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) {
                call.reject("no clipboard");
                return;
            }
            cm.setPrimaryClip(ClipData.newPlainText("timetable", text));
            call.resolve();
        });
    }

    @PluginMethod
    public void paste(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        act.runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
            JSObject o = new JSObject();
            String text = "";
            if (cm != null && cm.hasPrimaryClip()) {
                ClipData clip = cm.getPrimaryClip();
                if (clip != null && clip.getItemCount() > 0) {
                    CharSequence cs = clip.getItemAt(0).coerceToText(act);
                    if (cs != null) text = cs.toString();
                }
            }
            o.put("text", text);
            call.resolve(o);
        });
    }

    /* ---------------- 触感：直接驱动马达，不走 WebView 的触摸反馈（用户关掉「触摸振动」后那条路是静音的） ---------------- */

    @PluginMethod
    public void haptic(PluginCall call) {
        String kind = call.getString("kind", "selection");
        Activity act = getActivity();
        if (act == null) {
            call.resolve();
            return;
        }
        act.runOnUiThread(() -> {
            if (!vibrate(act, kind)) {
                View v = getBridge().getWebView();
                if (v != null) v.performHapticFeedback(feedbackConstant(kind), HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING);
            }
            call.resolve();
        });
    }

    private static int feedbackConstant(String kind) {
        switch (kind) {
            case "success":
                return Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.KEYBOARD_TAP;
            case "warning":
            case "error":
                return Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
            case "medium":
            case "heavy":
                return HapticFeedbackConstants.LONG_PRESS;
            case "light":
                return HapticFeedbackConstants.KEYBOARD_TAP;
            default:
                return Build.VERSION.SDK_INT >= 34 ? HapticFeedbackConstants.SEGMENT_FREQUENT_TICK : HapticFeedbackConstants.CLOCK_TICK;
        }
    }

    private static Vibrator vibrator(Context ctx) {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm == null ? null : vm.getDefaultVibrator();
        }
        return (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
    }

    /** 触感分级对齐 iOS UIFeedbackGenerator：
        selection 最轻刻度；light / medium / heavy 三档冲击；success / warning / error 是多段组合。
        优先用 Composition 原语按幅度合成（线性马达），不支持时退到预置波形；标为物理模拟类振动，不受「触摸反馈」开关影响 */
    private static boolean vibrate(Context ctx, String kind) {
        Vibrator vib = vibrator(ctx);
        if (vib == null || !vib.hasVibrator()) return false;
        try {
            VibrationEffect e = null;
            if (Build.VERSION.SDK_INT >= 30) e = composed(vib, kind);
            if (e == null && Build.VERSION.SDK_INT >= 29) e = predefined(kind);
            if (e == null && Build.VERSION.SDK_INT >= 26) e = oneShot(kind);
            if (e == null) return false;
            if (Build.VERSION.SDK_INT >= 33) {
                vib.vibrate(e, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_PHYSICAL_EMULATION));
            } else {
                vib.vibrate(e);
            }
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static VibrationEffect composed(Vibrator vib, String kind) {
        int tick = VibrationEffect.Composition.PRIMITIVE_TICK;
        int click = VibrationEffect.Composition.PRIMITIVE_CLICK;
        if (!vib.areAllPrimitivesSupported(tick, click)) return null;
        int low = Build.VERSION.SDK_INT >= 31 && vib.areAllPrimitivesSupported(VibrationEffect.Composition.PRIMITIVE_LOW_TICK)
                ? VibrationEffect.Composition.PRIMITIVE_LOW_TICK : tick;
        VibrationEffect.Composition c = VibrationEffect.startComposition();
        switch (kind) {
            case "light":
                c.addPrimitive(tick, 0.55f);
                break;
            case "medium":
                c.addPrimitive(click, 0.6f);
                break;
            case "heavy":
                c.addPrimitive(click, 1f);
                break;
            case "success":
                c.addPrimitive(tick, 0.5f).addPrimitive(click, 0.8f, 90);
                break;
            case "warning":
                c.addPrimitive(click, 0.7f).addPrimitive(tick, 0.45f, 110);
                break;
            case "error":
                c.addPrimitive(click, 0.6f).addPrimitive(click, 0.6f, 80).addPrimitive(tick, 0.4f, 100);
                break;
            default:
                c.addPrimitive(low, low == tick ? 0.35f : 0.7f);
        }
        return c.compose();
    }

    private static VibrationEffect predefined(String kind) {
        switch (kind) {
            case "light":
                return VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK);
            case "medium":
            case "success":
            case "warning":
                return VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK);
            case "heavy":
                return VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK);
            case "error":
                return VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK);
            default:
                return VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK);
        }
    }

    private static VibrationEffect oneShot(String kind) {
        switch (kind) {
            case "light":
                return VibrationEffect.createOneShot(8, 120);
            case "medium":
            case "success":
            case "warning":
                return VibrationEffect.createOneShot(14, 180);
            case "heavy":
                return VibrationEffect.createOneShot(20, 255);
            case "error":
                return VibrationEffect.createWaveform(new long[]{0, 14, 70, 14}, new int[]{0, 180, 0, 180}, -1);
            default:
                return VibrationEffect.createOneShot(5, 80);
        }
    }

    /** 系统的本应用详情页：权限被永久拒绝后从这里放开 */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", act.getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        act.startActivity(i);
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
        ThemeApply.remember(getContext(), color, light, Boolean.TRUE.equals(call.getBoolean("system")));
        Activity act = getActivity();
        if (act != null) act.runOnUiThread(() -> ThemeApply.apply(act, getBridge().getWebView(), color, light));
        BaseWidget.updateAll(getContext());
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
