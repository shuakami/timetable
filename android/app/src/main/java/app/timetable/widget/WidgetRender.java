package app.timetable.widget;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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

    /** 卡片配色，与页面三套主题的 --c-surface / --c-ink* / --c-accent / --c-tint-base / --c-ink-mix 一一对应 */
    static final class Palette {
        final int surface, ink, ink3, ink4, accent, tintBase, inkMix;

        Palette(int surface, int ink, int ink3, int ink4, int accent, int tintBase, int inkMix) {
            this.surface = surface;
            this.ink = ink;
            this.ink3 = ink3;
            this.ink4 = ink4;
            this.accent = accent;
            this.tintBase = tintBase;
            this.inkMix = inkMix;
        }

        /** 课程色按比例铺在卡片底上，对应原型 tint() */
        int tint(int color, int percent) {
            return WidgetStore.mix(color, tintBase, percent / 100f);
        }

        /** 课名字色：浅色下压深，深色下提亮，对应原型里和 --c-ink-mix 的混合 */
        int deepen(int color, int percent) {
            return WidgetStore.mix(color, inkMix, percent / 100f);
        }
    }

    static final Palette LIGHT = new Palette(0xFFFFFFFF, 0xFF16171A, 0xFF8A8E97, 0xFFA2A6AF, 0xFF4F5BD5, 0xFFFFFFFF, 0xFF000000);
    static final Palette DARK = new Palette(0xFF1C1D21, 0xFFF1F1EF, 0xFF8F939C, 0xFF8F939C, 0xFF7C8FF0, 0xFF26272C, 0xFFFFFFFF);
    static final Palette BLACK = new Palette(0xFF121214, 0xFFF1F1EF, 0xFF8F939C, 0xFF8F939C, 0xFF7C8FF0, 0xFF1D1D20, 0xFFFFFFFF);

    /**
     * 跟 App 的主题走（页面每次切主题都会把底色、深浅和是否跟随系统记到 tt.theme）；
     * 跟随系统或还没打开过 App 时按系统深色模式。
     * 不走资源限定符：部分桌面用自己的配置解析资源，深浅会和 App 不一致。
     */
    static Palette palette(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences("tt.theme", Context.MODE_PRIVATE);
        if (sp.getBoolean("system", true)) return WidgetStore.isNight(ctx) ? DARK : LIGHT;
        if (sp.getBoolean("light", true)) return LIGHT;
        return sp.getInt("bg", 0) == 0xFF000000 ? BLACK : DARK;
    }

    private WidgetRender() {
    }

    public static RemoteViews build(Context ctx, String style, Data data, long now) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layoutOf(style));
        v.setOnClickPendingIntent(R.id.widget_root, open(ctx));
        Palette p = palette(ctx);
        v.setInt(R.id.widget_root_bg, "setColorFilter", p.surface);
        theme(ctx, v, p);
        String today = WidgetStore.localDate(now);
        switch (style) {
            case "next":
                next(ctx, v, p, data, today, now);
                break;
            case "twoDays":
                twoDays(ctx, v, p, data, today, now);
                break;
            case "week":
                week(ctx, v, p, data, today, now);
                break;
            default:
                todayList(ctx, v, p, data, today, now);
        }
        return v;
    }

    /** 布局里的字色是浅色默认值，这里按主题整体重设一遍；课程行、周格子的字色在各自填充时设 */
    private static void theme(Context ctx, RemoteViews v, Palette p) {
        paint(ctx, v, p.ink, "w_day", "w_num", "w_week");
        paint(ctx, v, p.accent, "w_wd");
        paint(ctx, v, p.ink3, "w_label", "w_unit", "w_empty");
        paint(ctx, v, p.ink4, "w_sub", "w_sub2", "w_date");
    }

    private static void paint(Context ctx, RemoteViews v, int color, String... names) {
        for (String n : names) {
            int id = id(ctx, n);
            if (id != 0) v.setTextColor(id, color);
        }
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

    private static void head(Context ctx, RemoteViews v, String date, String sub) {
        v.setTextViewText(R.id.w_day, String.valueOf(WidgetStore.dayOfMonth(date)));
        v.setTextViewText(R.id.w_wd, WidgetStore.weekdayLabel(WidgetStore.weekdayOf(date)));
        v.setTextViewText(R.id.w_sub, sub == null ? "" : sub);
    }

    /** 一行课：底色是课程色 8% 铺在卡片底上；正在上的那节描一圈课程色边框、课名用课程色，时间位换成剩余时长 */
    private static void row(Context ctx, RemoteViews v, Palette p, String prefix, int idx, Item it, boolean now, String time) {
        int rowId = id(ctx, prefix + idx);
        if (it == null) {
            v.setViewVisibility(rowId, View.GONE);
            return;
        }
        v.setViewVisibility(rowId, View.VISIBLE);
        v.setInt(id(ctx, prefix + idx + "_bg"), "setColorFilter", p.tint(it.color, 8));
        v.setViewVisibility(id(ctx, prefix + idx + "_ring"), now ? View.VISIBLE : View.GONE);
        v.setInt(id(ctx, prefix + idx + "_ring"), "setColorFilter", it.color);
        v.setInt(id(ctx, prefix + idx + "_bar"), "setColorFilter", it.color);
        v.setTextViewText(id(ctx, prefix + idx + "_name"), it.name);
        v.setTextColor(id(ctx, prefix + idx + "_name"), now ? p.deepen(it.color, 72) : p.ink);
        int locId = id(ctx, prefix + idx + "_loc");
        if (locId != 0) {
            String meta = it.loc;
            if (meta.isEmpty()) meta = it.teacher;
            v.setTextViewText(locId, meta);
            v.setTextColor(locId, p.ink3);
            v.setViewVisibility(locId, meta.isEmpty() ? View.GONE : View.VISIBLE);
        }
        int timeId = id(ctx, prefix + idx + "_time");
        if (timeId != 0) {
            v.setTextViewText(timeId, time != null ? time : it.start);
            v.setTextColor(timeId, p.ink3);
        }
    }

    /* ---------------- 空状态 ---------------- */

    private static boolean noData(Data data) {
        return data == null || data.days.isEmpty();
    }

    /** 从 fromExclusive 之后（不含）起第一个有课的日子 */
    private static Day nextClassDay(Data data, String fromExclusive) {
        if (data == null) return null;
        for (Day d : data.days) {
            if (d.date.compareTo(fromExclusive) > 0 && !live(d).isEmpty()) return d;
        }
        return null;
    }

    /** 今天之后某一天的称呼：明天 / 周四 / 10月21日 */
    private static String dayName(String today, String date) {
        int diff = WidgetStore.daysBetween(today, date);
        if (diff == 1) return "明天";
        if (diff > 1 && diff < 7) return WidgetStore.weekdayLabel(WidgetStore.weekdayOf(date));
        return WidgetStore.monthOf(date) + "月" + WidgetStore.dayOfMonth(date) + "日";
    }

    /** 接下来一段时间都没课时给出的原因，一句话 */
    private static String emptyReason(Data data, String today) {
        if (noData(data)) return "还没有课表";
        Day first = null;
        for (Day d : data.days) if (!live(d).isEmpty()) { first = d; break; }
        if (first != null && first.date.compareTo(today) > 0 && data.days.get(0).date.compareTo(today) > 0) {
            return WidgetStore.monthOf(first.date) + "月" + WidgetStore.dayOfMonth(first.date) + "日开学";
        }
        String last = data.days.get(data.days.size() - 1).date;
        if (last.compareTo(today) < 0 && data.week >= data.totalWeeks) return "本学期已结束";
        return "近两周没有课";
    }

    private static void empty(Context ctx, RemoteViews v, String text) {
        int id = id(ctx, "w_empty");
        if (id == 0) return;
        v.setViewVisibility(id, text == null ? View.GONE : View.VISIBLE);
        if (text != null) v.setTextViewText(id, text);
    }

    /* ---------------- 今日列表 ---------------- */

    private static void todayList(Context ctx, RemoteViews v, Palette p, Data data, String today, long now) {
        Day d = data != null ? data.day(today) : null;
        List<Item> items = live(d);
        Item cur = current(items, now);
        List<Item> show = pending(items, now);
        String sub;
        if (!show.isEmpty()) {
            sub = "还剩 " + show.size() + " 节";
        } else {
            Day nx = nextClassDay(data, today);
            if (nx != null) {
                show = live(nx);
                sub = dayName(today, nx.date) + " " + show.size() + " 节";
            } else {
                sub = "";
            }
        }
        head(ctx, v, today, sub);
        empty(ctx, v, show.isEmpty() ? emptyReason(data, today) : null);
        for (int i = 0; i < ROWS; i++) {
            Item it = i < show.size() ? show.get(i) : null;
            row(ctx, v, p, "row", i, it, it != null && it == cur, it != null && it == cur ? left(it, now) : null);
        }
    }

    private static String left(Item it, long now) {
        long mins = Math.max(1, (it.endAt - now) / 60000);
        return mins >= 60 ? "还剩 " + mins / 60 + " 小时" + (mins % 60 == 0 ? "" : " " + mins % 60 + " 分") : "还剩 " + mins + " 分";
    }

    /* ---------------- 下一节 ---------------- */

    private static void next(Context ctx, RemoteViews v, Palette p, Data data, String today, long now) {
        Day d = data != null ? data.day(today) : null;
        List<Item> items = live(d);
        Item cur = current(items, now);
        if (cur != null) {
            v.setTextViewText(R.id.w_label, "上课中");
            v.setViewVisibility(R.id.w_num, View.VISIBLE);
            v.setTextViewText(R.id.w_num, String.valueOf(Math.max(1, (int) ((cur.endAt - now) / 60000))));
            v.setTextViewText(R.id.w_unit, "分钟后下课");
            row(ctx, v, p, "row", 0, cur, true, null);
            return;
        }
        Item nx = upcoming(items, now);
        String label = "下一节";
        if (nx == null) {
            Day nd = nextClassDay(data, today);
            if (nd != null) {
                nx = live(nd).get(0);
                label = dayName(today, nd.date) + "第一节";
            }
        }
        v.setTextViewText(R.id.w_label, label);
        if (nx == null) {
            v.setViewVisibility(R.id.w_num, View.GONE);
            v.setTextViewText(R.id.w_unit, emptyReason(data, today));
            row(ctx, v, p, "row", 0, null, false, null);
            return;
        }
        v.setViewVisibility(R.id.w_num, View.VISIBLE);
        long mins = (nx.startAt - now) / 60000;
        if (mins >= 24 * 60) {
            v.setTextViewText(R.id.w_num, String.valueOf(WidgetStore.daysBetween(today, WidgetStore.localDate(nx.startAt))));
            v.setTextViewText(R.id.w_unit, "天后");
        } else if (mins >= 60) {
            v.setTextViewText(R.id.w_num, String.valueOf(mins / 60));
            long rem = mins % 60;
            v.setTextViewText(R.id.w_unit, rem == 0 ? "小时后" : "小时 " + rem + " 分钟后");
        } else {
            v.setTextViewText(R.id.w_num, String.valueOf(Math.max(1, mins)));
            v.setTextViewText(R.id.w_unit, "分钟后");
        }
        row(ctx, v, p, "row", 0, nx, false, null);
    }

    /* ---------------- 今天与明天 ---------------- */

    /** 左列是今天（上完就换成下一个有课的日子），右列是再往后一个有课的日子 */
    private static void twoDays(Context ctx, RemoteViews v, Palette p, Data data, String today, long now) {
        Day d = data != null ? data.day(today) : null;
        List<Item> items = live(d);
        Item cur = current(items, now);
        List<Item> show = pending(items, now);
        String sub;
        String anchor = today;
        if (!show.isEmpty()) {
            sub = "还剩 " + show.size() + " 节";
        } else {
            Day nx = nextClassDay(data, today);
            if (nx != null) {
                show = live(nx);
                anchor = nx.date;
                sub = dayName(today, nx.date) + " " + show.size() + " 节";
            } else {
                sub = "";
            }
        }
        head(ctx, v, today, sub);
        empty(ctx, v, show.isEmpty() ? emptyReason(data, today) : null);
        for (int i = 0; i < ROWS; i++) {
            Item it = i < show.size() ? show.get(i) : null;
            row(ctx, v, p, "row", i, it, it != null && it == cur, it != null && it == cur ? left(it, now) : null);
        }
        Day second = nextClassDay(data, anchor);
        List<Item> t = live(second);
        v.setTextViewText(R.id.w_sub2, second == null ? "" : dayName(today, second.date) + " " + t.size() + " 节");
        for (int i = 0; i < ROWS; i++) {
            row(ctx, v, p, "trow", i, i < t.size() ? t.get(i) : null, false, null);
        }
    }

    /* ---------------- 本周网格 ---------------- */

    /** 周末看下一周；整周没课时只留一句原因 */
    private static void week(Context ctx, RemoteViews v, Palette p, Data data, String today, long now) {
        String dateLabel = WidgetStore.monthOf(today) + "月" + WidgetStore.dayOfMonth(today) + "日";
        if (noData(data)) {
            v.setTextViewText(R.id.w_week, "本周");
            v.setTextViewText(R.id.w_date, dateLabel);
            v.setViewVisibility(R.id.w_grid, View.GONE);
            empty(ctx, v, emptyReason(data, today));
            return;
        }
        Day cur = data.day(today);
        int week = cur != null ? cur.week : data.week;
        if (WidgetStore.weekdayOf(today) >= 6 && week < data.totalWeeks && hasClasses(data, week + 1)) {
            week++;
            dateLabel = "下周";
        }
        v.setTextViewText(R.id.w_week, "第 " + week + " 周");
        v.setTextViewText(R.id.w_date, dateLabel);
        if (!hasClasses(data, week)) {
            v.setViewVisibility(R.id.w_grid, View.GONE);
            empty(ctx, v, emptyReason(data, today));
            return;
        }
        v.setViewVisibility(R.id.w_grid, View.VISIBLE);
        empty(ctx, v, null);
        List<Day> cols = new ArrayList<>();
        for (Day d : data.days) if (d.week == week && d.weekday <= 5) cols.add(d);
        for (int c = 0; c < 5; c++) {
            Day d = c < cols.size() ? cols.get(c) : null;
            boolean isToday = d != null && d.date.equals(today);
            v.setTextViewText(id(ctx, "wd" + c), WidgetStore.weekdayLabel(c + 1));
            v.setTextColor(id(ctx, "wd" + c), isToday ? p.accent : p.ink3);
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
                v.setInt(id(ctx, cid + "_bg"), "setColorFilter", p.tint(it.color, 8));
                v.setViewVisibility(id(ctx, cid + "_ring"), nowCell ? View.VISIBLE : View.GONE);
                v.setInt(id(ctx, cid + "_ring"), "setColorFilter", it.color);
                v.setTextViewText(id(ctx, cid + "_name"), it.name);
                v.setTextColor(id(ctx, cid + "_name"), p.deepen(it.color, 88));
                v.setTextViewText(id(ctx, cid + "_time"), it.start);
                v.setTextColor(id(ctx, cid + "_time"), p.ink3);
                v.setTextViewText(id(ctx, cid + "_loc"), it.loc);
                v.setTextColor(id(ctx, cid + "_loc"), p.ink4);
            }
        }
    }

    private static boolean hasClasses(Data data, int week) {
        for (Day d : data.days) if (d.week == week && d.weekday <= 5 && !live(d).isEmpty()) return true;
        return false;
    }

}
