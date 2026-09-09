package app.timetable.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机、应用更新、跨天、改系统时间之后重画一次并重排闹钟（更新会清掉已排的闹钟，不重画桌面只剩 initialLayout 的空底）。 */
public class WidgetSystemReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        BaseWidget.updateAll(ctx);
        WidgetRefresh.schedule(ctx);
    }
}
