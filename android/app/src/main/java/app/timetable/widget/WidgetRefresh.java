package app.timetable.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

/** 倒计时和「上课中」要跟着时间走，所以按下一个整点事件重排一次刷新。 */
public class WidgetRefresh extends BroadcastReceiver {
    private static final String ACTION = "app.timetable.WIDGET_REFRESH";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        BaseWidget.updateAll(ctx);
        schedule(ctx);
    }

    private static boolean anyWidget(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (Class<?> p : BaseWidget.PROVIDERS) {
            if (mgr.getAppWidgetIds(new ComponentName(ctx, p)).length > 0) return true;
        }
        return false;
    }

    /** 下一次刷新时刻：最近的一节课开始/结束，最长不超过 15 分钟 */
    static void schedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = pending(ctx);
        if (!anyWidget(ctx)) {
            am.cancel(pi);
            return;
        }
        long now = System.currentTimeMillis();
        long at = now + 15 * 60000L;
        WidgetStore.Data data = WidgetStore.read(ctx);
        if (data != null) {
            String today = WidgetStore.localDate(now);
            WidgetStore.Day d = data.day(today);
            if (d != null) {
                for (WidgetStore.Item it : d.items) {
                    if (it.cancelled) continue;
                    if (it.startAt > now && it.startAt < at) at = it.startAt;
                    if (it.endAt > now && it.endAt < at) at = it.endAt;
                }
            }
        }
        am.set(AlarmManager.RTC, Math.max(at, now + 60000L), pi);
    }

    private static PendingIntent pending(Context ctx) {
        Intent i = new Intent(ctx, WidgetRefresh.class).setAction(ACTION);
        return PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
