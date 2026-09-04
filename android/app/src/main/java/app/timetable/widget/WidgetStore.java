package app.timetable.widget;

import android.content.Context;
import android.content.res.Configuration;
import android.content.SharedPreferences;

import org.json.JSONArray;

import app.timetable.R;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** 小组件的数据源：WebView 写进 SharedPreferences 的课表快照，这里解析成渲染用的结构。 */
public final class WidgetStore {
    private static final String PREFS = "timetable.widget";
    private static final String KEY = "data";

    public static final class Item {
        public String name = "";
        public String loc = "";
        public String teacher = "";
        public int color = 0xFF4F5BD5;
        public String start = "";
        public long startAt;
        public long endAt;
        public boolean cancelled;
    }

    public static final class Day {
        public String date = "";
        public int weekday;
        public int week;
        public final List<Item> items = new ArrayList<>();
    }

    public static final class Data {
        public int week;
        public int totalWeeks;
        public final List<Day> days = new ArrayList<>();

        public Day day(String date) {
            for (Day d : days) if (d.date.equals(date)) return d;
            return null;
        }
    }

    private WidgetStore() {
    }

    public static void write(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY, json).apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static Data read(Context ctx) {
        String raw = prefs(ctx).getString(KEY, null);
        if (raw == null) return null;
        try {
            JSONObject o = new JSONObject(raw);
            Data d = new Data();
            d.week = o.optInt("week");
            d.totalWeeks = o.optInt("totalWeeks");
            JSONArray days = o.optJSONArray("days");
            for (int i = 0; days != null && i < days.length(); i++) {
                JSONObject dj = days.getJSONObject(i);
                Day day = new Day();
                day.date = dj.optString("date");
                day.weekday = dj.optInt("weekday");
                day.week = dj.optInt("week");
                JSONArray items = dj.optJSONArray("items");
                for (int j = 0; items != null && j < items.length(); j++) {
                    JSONObject ij = items.getJSONObject(j);
                    Item it = new Item();
                    it.name = ij.optString("name");
                    it.loc = ij.optString("loc");
                    it.teacher = ij.optString("teacher");
                    it.color = parseColor(ij.optString("color"), 0xFF4F5BD5);
                    it.start = ij.optString("start");
                    it.startAt = ij.optLong("startAt");
                    it.endAt = ij.optLong("endAt");
                    it.cancelled = ij.optBoolean("cancelled");
                    day.items.add(it);
                }
                d.days.add(day);
            }
            return d;
        } catch (JSONException e) {
            return null;
        }
    }

    public static int parseColor(String hex, int fallback) {
        try {
            if (hex == null || hex.length() < 4) return fallback;
            return 0xFF000000 | (int) (Long.parseLong(hex.replace("#", ""), 16) & 0xFFFFFF);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    /** 与 WebView 侧同一套本地日期字符串 */
    public static String localDate(long at) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(at));
    }

    public static String nextDate(String date) {
        try {
            Calendar c = Calendar.getInstance();
            c.setTime(new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(date));
            c.add(Calendar.DAY_OF_MONTH, 1);
            return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
        } catch (Exception e) {
            return date;
        }
    }

    public static int dayOfMonth(String date) {
        String[] p = date.split("-");
        return p.length == 3 ? Integer.parseInt(p[2]) : 1;
    }

    public static int monthOf(String date) {
        String[] p = date.split("-");
        return p.length == 3 ? Integer.parseInt(p[1]) : 1;
    }

    public static String weekdayLabel(int weekday) {
        switch (weekday) {
            case 1: return "周一";
            case 2: return "周二";
            case 3: return "周三";
            case 4: return "周四";
            case 5: return "周五";
            case 6: return "周六";
            default: return "周日";
        }
    }

    /** 颜色按比例混白，对应原型里的 tint() */
    /** 课程色与卡片底色按比例混合（深色下底色随之变深） */
    public static int tint(Context ctx, int color, int percent) {
        return mix(color, 0xFFFFFFFF, percent / 100f);
    }

    /** 课名字色：把课程色压深，保证在浅色卡片上可读 */
    public static int deepen(Context ctx, int color, int percent) {
        return mix(color, 0xFF000000, percent / 100f);
    }

    public static boolean isNight(Context ctx) {
        return (ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private static int mix(int a, int b, float k) {
        int r = Math.round(((a >> 16) & 0xFF) * k + ((b >> 16) & 0xFF) * (1 - k));
        int g = Math.round(((a >> 8) & 0xFF) * k + ((b >> 8) & 0xFF) * (1 - k));
        int bl = Math.round((a & 0xFF) * k + (b & 0xFF) * (1 - k));
        return 0xFF000000 | (r << 16) | (g << 8) | bl;
    }
}
