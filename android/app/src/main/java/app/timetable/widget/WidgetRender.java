package app.timetable.widget;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import java.util.ArrayList;
import java.util.List;

import app.timetable.MainActivity;
import app.timetable.R;
import app.timetable.widget.WidgetStore.Data;
import app.timetable.widget.WidgetStore.Day;
import app.timetable.widget.WidgetStore.Item;

/** 把快照画成 RemoteViews。间距、字号、配色对齐原型 10 屏的小组件。 */
public final class WidgetRender {

    /** 今日/今明两天每列的行数，与原型一致 */
    private static final int ROWS = 2;

    private WidgetRender() {
    }

    public static RemoteViews build(Context ctx, String style, Data data, long now) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layoutOf(style));
        v.setOnClickPendingIntent(R.id.widget_root, open(ctx));
        // 外层卡片底不用资源限定符：部分桌面用自己的配置解析资源，深浅会不一致，这里按 App 侧的夜间模式直接指定
        v.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg);
        if (data == null) {
            return v;
        }
        String today = WidgetStore.localDate(now);
        Day d = data.day(today);
        switch (style) {
            case "next":
                next(ctx, v, d, data.day(WidgetStore.nextDate(today)), now);
                break;
            case "twoDays":
                twoDays(ctx, v, today, d, data.day(WidgetStore.nextDate(today)), now);
                break;
            case "week":
                week(ctx, v, data, today, now);
                break;
            default:
                todayList(ctx, v, today, d, now);
        }
        return v;
    }

    public static int layoutOf(String style) {
        switch (style) {
            case "next": return R.layout.widget_next;
            case "twoDays": return R.layout.widget_two_days;
            case "week": return R.layout.widget_week;
            default: return R.layout.widget_today;
        }
    }

    private static PendingIntent open(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, 0, i, flags);
    }

    private static int id(Context ctx, String name) {
        return ctx.getResources().getIdentifier(name, "id", ctx.getPackageName());
    }

    private static List<Item> live(Day d) {
        List<Item> out = new ArrayList<>();
        if (d == null) return out;
        for (Item it : d.items) if (!it.cancelled) out.add(it);
        return out;
    }

    private static Item current(List<Item> items, long now) {
        for (Item it : items) if (it.startAt <= now && now < it.endAt) return it;
        return null;
    }

    private static Item upcoming(List<Item> items, long now) {
        for (Item it : items) if (it.startAt > now) return it;
        return null;
    }

    /** 今日列表只放还没下课的：上课中的排第一，上完的不再占位 */
    private static List<Item> pending(List<Item> items, long now) {
        List<Item> out = new ArrayList<>();
        for (Item it : items) if (it.endAt > now) out.add(it);
        return out;
    }

    private static int remaining(List<Item> items, long now) {
        int n = 0;
        for (Item it : items) if (it.endAt > now) n++;
        return n;
    }

    private static void head(Context ctx, RemoteViews v, String date, int weekday, String sub) {
        v.setTextViewText(R.id.w_day, String.valueOf(WidgetStore.dayOfMonth(date)));
        v.setTextViewText(R.id.w_wd, WidgetStore.weekdayLabel(weekday));
        v.setTextViewText(R.id.w_sub, sub == null ? "" : sub);
    }

    /** 一行课：底色是课程色 8% 混白；正在上的那节底色加深到 30%、课名用课程色，时间位换成剩余时长 */
    private static void row(Context ctx, RemoteViews v, String prefix, int idx, Item it, boolean now, String time) {
        int rowId = id(ctx, prefix + idx);
        if (it == null) {
            v.setViewVisibility(rowId, View.GONE);
            return;
        }
        v.setViewVisibility(rowId, View.VISIBLE);
        v.setInt(id(ctx, prefix + idx + "_bg"), "setColorFilter", WidgetStore.tint(ctx, it.color, now ? 30 : 8));
        v.setInt(id(ctx, prefix + idx + "_bar"), "setColorFilter", it.color);
        v.setTextViewText(id(ctx, prefix + idx + "_name"), it.name);
        v.setTextColor(id(ctx, prefix + idx + "_name"), now ? WidgetStore.deepen(ctx, it.color, 72) : ctx.getColor(R.color.widgetInk));
        int locId = id(ctx, prefix + idx + "_loc");
        if (locId != 0) {
            String meta = it.loc;
            if (meta.isEmpty()) meta = it.teacher;
            v.setTextViewText(locId, meta);
            v.setViewVisibility(locId, meta.isEmpty() ? View.GONE : View.VISIBLE);
        }
        int timeId = id(ctx, prefix + idx + "_time");
        if (timeId != 0) v.setTextViewText(timeId, time != null ? time : it.start);
    }

    /* ---------------- 今日列表 ---------------- */

    private static void todayList(Context ctx, RemoteViews v, String today, Day d, long now) {
        List<Item> items = live(d);
        int left = remaining(items, now);
        head(ctx, v, today, d != null ? d.weekday : 1, left > 0 ? "还剩 " + left + " 节" : "没有课了");
        Item cur = current(items, now);
        List<Item> show = pending(items, now);
        for (int i = 0; i < ROWS; i++) {
            Item it = i < show.size() ? show.get(i) : null;
            row(ctx, v, "row", i, it, it != null && it == cur, it != null && it == cur ? left(it, now) : null);
        }
    }

    private static String left(Item it, long now) {
        long mins = Math.max(1, (it.endAt - now) / 60000);
        return mins >= 60 ? "还剩 " + mins / 60 + " 小时" + (mins % 60 == 0 ? "" : " " + mins % 60 + " 分") : "还剩 " + mins + " 分";
    }

    /* ---------------- 下一节 ---------------- */

    private static void next(Context ctx, RemoteViews v, Day d, Day tomorrow, long now) {
        List<Item> items = live(d);
        Item cur = current(items, now);
        Item nx = upcoming(items, now);
        boolean isTomorrow = false;
        if (cur == null && nx == null) {
            nx = upcoming(live(tomorrow), now);
            isTomorrow = nx != null;
        }
        if (cur != null) {
            v.setTextViewText(R.id.w_label, "上课中");
            v.setTextViewText(R.id.w_num, String.valueOf(Math.max(1, (int) ((cur.endAt - now) / 60000))));
            v.setTextViewText(R.id.w_unit, "分钟后下课");
            row(ctx, v, "row", 0, cur, true, null);
            return;
        }
        if (nx == null) {
            v.setTextViewText(R.id.w_label, "下一节");
            v.setTextViewText(R.id.w_num, "—");
            v.setTextViewText(R.id.w_unit, "这两天没有课");
            row(ctx, v, "row", 0, null, false, null);
            return;
        }
        long mins = (nx.startAt - now) / 60000;
        v.setTextViewText(R.id.w_label, isTomorrow ? "明天第一节" : "下一节");
        if (mins >= 60) {
            v.setTextViewText(R.id.w_num, String.valueOf(mins / 60));
            long rem = mins % 60;
            v.setTextViewText(R.id.w_unit, rem == 0 ? "小时后" : "小时 " + rem + " 分钟后");
        } else {
            v.setTextViewText(R.id.w_num, String.valueOf(Math.max(1, mins)));
            v.setTextViewText(R.id.w_unit, "分钟后");
        }
        row(ctx, v, "row", 0, nx, false, null);
    }

    /* ---------------- 今天与明天 ---------------- */

    private static void twoDays(Context ctx, RemoteViews v, String today, Day d, Day tm, long now) {
        List<Item> items = live(d);
        int left = remaining(items, now);
        head(ctx, v, today, d != null ? d.weekday : 1, left > 0 ? "还剩 " + left + " 节" : "没有课了");
        Item cur = current(items, now);
        List<Item> show = pending(items, now);
        for (int i = 0; i < ROWS; i++) {
            Item it = i < show.size() ? show.get(i) : null;
            row(ctx, v, "row", i, it, it != null && it == cur, it != null && it == cur ? left(it, now) : null);
        }
        List<Item> t = live(tm);
        v.setTextViewText(R.id.w_sub2, t.isEmpty() ? "明天没有课" : "明天 " + t.size() + " 节");
        for (int i = 0; i < ROWS; i++) {
            row(ctx, v, "trow", i, i < t.size() ? t.get(i) : null, false, null);
        }
    }

    /* ---------------- 本周网格 ---------------- */

    private static void week(Context ctx, RemoteViews v, Data data, String today, long now) {
        Day cur = data.day(today);
        int week = cur != null ? cur.week : data.week;
        v.setTextViewText(R.id.w_week, "第 " + week + " 周");
        v.setTextViewText(R.id.w_date, WidgetStore.monthOf(today) + "月" + WidgetStore.dayOfMonth(today) + "日");
        List<Day> cols = new ArrayList<>();
        for (Day d : data.days) if (d.week == week && d.weekday <= 5) cols.add(d);
        for (int c = 0; c < 5; c++) {
            Day d = c < cols.size() ? cols.get(c) : null;
            boolean isToday = d != null && d.date.equals(today);
            v.setTextViewText(id(ctx, "wd" + c), WidgetStore.weekdayLabel(c + 1));
            v.setTextColor(id(ctx, "wd" + c), isToday ? ctx.getColor(R.color.widgetAccent) : ctx.getColor(R.color.widgetInk3));
            List<Item> items = live(d);
            for (int r = 0; r < 3; r++) {
                String cid = "c" + c + "_" + r;
                Item it = r < items.size() ? items.get(r) : null;
                if (it == null) {
                    v.setViewVisibility(id(ctx, cid), View.INVISIBLE);
                    continue;
                }
                boolean nowCell = it.startAt <= now && now < it.endAt;
                v.setViewVisibility(id(ctx, cid), View.VISIBLE);
                v.setInt(id(ctx, cid + "_bg"), "setColorFilter", WidgetStore.tint(ctx, it.color, nowCell ? 38 : 8));
                v.setTextViewText(id(ctx, cid + "_name"), it.name);
                v.setTextColor(id(ctx, cid + "_name"), WidgetStore.deepen(ctx, it.color, nowCell ? 70 : 88));
                v.setTextViewText(id(ctx, cid + "_time"), it.start);
                v.setTextViewText(id(ctx, cid + "_loc"), it.loc);
            }
        }
    }

}
