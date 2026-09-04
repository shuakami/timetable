package app.timetable.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机、跨天、改系统时间之后重画一次。 */
public class WidgetSystemReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        BaseWidget.updateAll(ctx);
        WidgetRefresh.schedule(ctx);
    }
}
