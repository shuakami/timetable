package app.timetable.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public abstract class BaseWidget extends AppWidgetProvider {

    protected abstract String style();

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetStore.Data data = WidgetStore.read(ctx);
        long now = System.currentTimeMillis();
        for (int id : ids) {
            RemoteViews v = WidgetRender.build(ctx, style(), data, now);
            mgr.updateAppWidget(id, v);
        }
        WidgetRefresh.schedule(ctx);
    }

    @Override
    public void onEnabled(Context ctx) {
        WidgetRefresh.schedule(ctx);
    }

    public static final Class<?>[] PROVIDERS = {
            TodayWidget.class, NextWidget.class, TwoDaysWidget.class, WeekWidget.class,
    };

    /** 课表、待办或时间变了就整体重画 */
    public static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (Class<?> p : PROVIDERS) {
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, p));
            if (ids.length == 0) continue;
            Intent i = new Intent(ctx, p);
            i.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            ctx.sendBroadcast(i);
        }
    }
}
