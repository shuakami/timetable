package app.timetable;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.ContentProviderResult;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.provider.Settings;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Reminders;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;

/**
 * 系统日历：应用自己的几本本地日历（ACCOUNT_TYPE_LOCAL，上课 / 作业 / 考试），以 sync adapter 身份读写。
 * 提醒由系统日历发出；页面只算差异，这里只做落地。
 * key/hash 存在事件的 SYNC_DATA1/2 上：映射就在日历里，不另存一份状态。
 */
@CapacitorPlugin(
        name = "TtCalendar",
        permissions = {
                @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR }),
        }
)
public class TtCalendar extends Plugin {

    private static final String ACCOUNT_NAME = "课程表";
    private static final String ACCOUNT_TYPE = CalendarContract.ACCOUNT_TYPE_LOCAL;
    /** 单批操作上限：Binder 事务有 1MB 限制，事件 + 提醒一起算 */
    private static final int BATCH = 120;

    /* ---------------- 权限 ---------------- */

    private static final String PREFS = "tt_calendar";
    private static final String KEY_ASKED = "asked";

    private boolean has() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 已经问过、系统又不再展示弹窗：只能去设置里开 */
    private boolean blocked() {
        if (!prefs().getBoolean(KEY_ASKED, false)) return false;
        return !ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), Manifest.permission.WRITE_CALENDAR);
    }

    private String current() {
        return has() ? "granted" : blocked() ? "denied" : "prompt";
    }

    private JSObject status(String s) {
        JSObject o = new JSObject();
        o.put("status", s);
        return o;
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        call.resolve(status(current()));
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        String now = current();
        if (!"prompt".equals(now)) {
            call.resolve(status(now));
            return;
        }
        prefs().edit().putBoolean(KEY_ASKED, true).apply();
        requestPermissionForAlias("calendar", call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        call.resolve(status(has() ? "granted" : "denied"));
    }

    /* ---------------- 日历 ---------------- */

    private static Uri asSync(Uri uri) {
        return uri.buildUpon()
                .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
                .appendQueryParameter(Calendars.ACCOUNT_NAME, ACCOUNT_NAME)
                .appendQueryParameter(Calendars.ACCOUNT_TYPE, ACCOUNT_TYPE)
                .build();
    }

    private static int parseColor(String hex, int fallback) {
        if (hex == null) return fallback;
        try {
            return Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    /** 账户下现有的日历：NAME -> _ID */
    private HashMap<String, Long> findCalendars() {
        return findCalendars(null);
    }

    /** 同上；顺带读出上次写进去的颜色（CAL_SYNC1），NAME -> hex */
    private HashMap<String, Long> findCalendars(HashMap<String, String> colors) {
        HashMap<String, Long> out = new HashMap<>();
        ContentResolver cr = getContext().getContentResolver();
        try (Cursor c = cr.query(
                Calendars.CONTENT_URI,
                new String[]{ Calendars._ID, Calendars.NAME, Calendars.CAL_SYNC1 },
                Calendars.ACCOUNT_NAME + "=? AND " + Calendars.ACCOUNT_TYPE + "=?",
                new String[]{ ACCOUNT_NAME, ACCOUNT_TYPE },
                null)) {
            while (c != null && c.moveToNext()) {
                String name = c.isNull(1) ? "" : c.getString(1);
                if (!out.containsKey(name)) {
                    out.put(name, c.getLong(0));
                    if (colors != null) colors.put(name, c.isNull(2) ? "" : c.getString(2));
                } else {
                    cr.delete(asSync(ContentUris.withAppendedId(Calendars.CONTENT_URI, c.getLong(0))), null, null);
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    /**
     * 找到或创建一组日历（每门课 / 作业 / 考试 / 周次各一本）；账户下多出来的旧日历删掉。
     * 颜色只在应用要的颜色变了时才写（上次写的值记在 CAL_SYNC1）：用户在系统日历里自己改的颜色不会被同步覆回去。
     * 本地日历必须以 sync adapter 身份插入，否则 Provider 拒绝。
     */
    @PluginMethod
    public void ensureCalendars(PluginCall call) {
        if (!has()) {
            call.reject("denied");
            return;
        }
        JSArray wanted = call.getArray("calendars", new JSArray());
        ContentResolver cr = getContext().getContentResolver();
        HashMap<String, String> written = new HashMap<>();
        HashMap<String, Long> have = findCalendars(written);
        JSObject ids = new JSObject();
        try {
            HashSet<String> keep = new HashSet<>();
            for (int i = 0; i < wanted.length(); i++) {
                JSONObject w = wanted.getJSONObject(i);
                String slug = w.getString("slug");
                String name = w.optString("name", ACCOUNT_NAME);
                String hex = w.optString("color", "");
                int color = parseColor(hex, 0xFF4F5BD5);
                keep.add(slug);
                Long id = have.get(slug);
                if (id != null) {
                    ContentValues v = new ContentValues();
                    v.put(Calendars.CALENDAR_DISPLAY_NAME, name);
                    if (!hex.equalsIgnoreCase(written.get(slug))) {
                        v.put(Calendars.CALENDAR_COLOR, color);
                        v.put(Calendars.CAL_SYNC1, hex);
                    }
                    v.put(Calendars.VISIBLE, 1);
                    v.put(Calendars.SYNC_EVENTS, 1);
                    cr.update(asSync(ContentUris.withAppendedId(Calendars.CONTENT_URI, id)), v, null, null);
                } else {
                    ContentValues v = new ContentValues();
                    v.put(Calendars.ACCOUNT_NAME, ACCOUNT_NAME);
                    v.put(Calendars.ACCOUNT_TYPE, ACCOUNT_TYPE);
                    v.put(Calendars.NAME, slug);
                    v.put(Calendars.CALENDAR_DISPLAY_NAME, name);
                    v.put(Calendars.CALENDAR_COLOR, color);
                    v.put(Calendars.CAL_SYNC1, hex);
                    v.put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_OWNER);
                    v.put(Calendars.OWNER_ACCOUNT, ACCOUNT_NAME);
                    v.put(Calendars.VISIBLE, 1);
                    v.put(Calendars.SYNC_EVENTS, 1);
                    v.put(Calendars.MAX_REMINDERS, 5);
                    v.put(Calendars.ALLOWED_REMINDERS, Reminders.METHOD_DEFAULT + "," + Reminders.METHOD_ALERT);
                    v.put(Calendars.ALLOWED_AVAILABILITY, Events.AVAILABILITY_BUSY + "," + Events.AVAILABILITY_FREE);
                    v.put(Calendars.ALLOWED_ATTENDEE_TYPES, String.valueOf(CalendarContract.Attendees.TYPE_NONE));
                    v.put(Calendars.CAN_ORGANIZER_RESPOND, 0);
                    v.put(Calendars.CAN_MODIFY_TIME_ZONE, 1);
                    v.put(Calendars.CALENDAR_TIME_ZONE, java.util.TimeZone.getDefault().getID());
                    Uri u = cr.insert(asSync(Calendars.CONTENT_URI), v);
                    if (u == null) {
                        call.reject("insert failed");
                        return;
                    }
                    id = ContentUris.parseId(u);
                }
                ids.put(slug, (long) id);
            }
            for (Map.Entry<String, Long> e : have.entrySet()) {
                if (!keep.contains(e.getKey())) {
                    cr.delete(asSync(ContentUris.withAppendedId(Calendars.CONTENT_URI, e.getValue())), null, null);
                }
            }
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
            return;
        }
        JSObject o = new JSObject();
        o.put("ids", ids);
        call.resolve(o);
    }

    /** 账户下全部事件：id + calendarId + key + hash，页面拿去和期望集合比 */
    @PluginMethod
    public void readAll(PluginCall call) {
        if (!has()) {
            call.reject("denied");
            return;
        }
        HashMap<String, Long> cals = findCalendars();
        JSArray out = new JSArray();
        if (!cals.isEmpty()) {
            StringBuilder in = new StringBuilder();
            for (Long id : cals.values()) {
                if (in.length() > 0) in.append(',');
                in.append(id);
            }
            ContentResolver cr = getContext().getContentResolver();
            try (Cursor c = cr.query(
                    asSync(Events.CONTENT_URI),
                    new String[]{ Events._ID, Events.CALENDAR_ID, Events.SYNC_DATA1, Events.SYNC_DATA2 },
                    Events.CALENDAR_ID + " IN (" + in + ") AND " + Events.DELETED + "=0",
                    null,
                    null)) {
                while (c != null && c.moveToNext()) {
                    JSObject e = new JSObject();
                    e.put("id", c.getLong(0));
                    e.put("calendarId", c.getLong(1));
                    e.put("key", c.isNull(2) ? "" : c.getString(2));
                    e.put("hash", c.isNull(3) ? "" : c.getString(3));
                    out.put(e);
                }
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
                return;
            }
        }
        JSObject o = new JSObject();
        o.put("events", out);
        call.resolve(o);
    }

    private ContentValues eventValues(long cal, JSONObject ev, String key, String hash, boolean hasAlarm) throws JSONException {
        ContentValues v = new ContentValues();
        v.put(Events.CALENDAR_ID, cal);
        v.put(Events.TITLE, ev.optString("title", ""));
        v.put(Events.EVENT_LOCATION, ev.isNull("location") ? "" : ev.optString("location", ""));
        v.put(Events.DESCRIPTION, ev.isNull("description") ? "" : ev.optString("description", ""));
        boolean allDay = ev.optBoolean("allDay", false);
        v.put(Events.ALL_DAY, allDay ? 1 : 0);
        v.put(Events.DTSTART, ev.getLong("start"));
        v.put(Events.EVENT_TIMEZONE, allDay ? "UTC" : ev.optString("tz", java.util.TimeZone.getDefault().getID()));
        String rrule = ev.isNull("rrule") ? null : ev.optString("rrule", null);
        if (rrule != null && !rrule.isEmpty()) {
            v.put(Events.RRULE, rrule);
            v.put(Events.DURATION, ev.optString("duration", "PT45M"));
            v.putNull(Events.DTEND);
            String ex = ev.isNull("exdate") ? null : ev.optString("exdate", null);
            if (ex != null && !ex.isEmpty()) v.put(Events.EXDATE, ex); else v.putNull(Events.EXDATE);
        } else {
            v.putNull(Events.RRULE);
            v.putNull(Events.EXDATE);
            v.putNull(Events.DURATION);
            v.put(Events.DTEND, ev.getLong("end"));
        }
        // 颜色属于日历：事件不单独着色，用户在系统日历里改日历颜色就整本一起变
        v.putNull(Events.EVENT_COLOR);
        v.put(Events.HAS_ALARM, hasAlarm ? 1 : 0);
        v.put(Events.AVAILABILITY, ev.optBoolean("busy", true) ? Events.AVAILABILITY_BUSY : Events.AVAILABILITY_FREE);
        v.put(Events.ACCESS_LEVEL, Events.ACCESS_PRIVATE);
        v.put(Events.STATUS, Events.STATUS_CONFIRMED);
        v.put(Events.GUESTS_CAN_MODIFY, 0);
        v.put(Events.GUESTS_CAN_INVITE_OTHERS, 0);
        v.put(Events.GUESTS_CAN_SEE_GUESTS, 0);
        v.put(Events.SYNC_DATA1, key);
        v.put(Events.SYNC_DATA2, hash);
        // 让系统日历在事件详情里显示「在 课程表 中打开」
        String link = ev.isNull("link") ? null : ev.optString("link", null);
        if (link != null && !link.isEmpty()) {
            v.put(Events.CUSTOM_APP_PACKAGE, getContext().getPackageName());
            v.put(Events.CUSTOM_APP_URI, link);
        } else {
            v.putNull(Events.CUSTOM_APP_PACKAGE);
            v.putNull(Events.CUSTOM_APP_URI);
        }
        return v;
    }

    private static int[] minutes(JSONObject item) {
        JSONArray arr = item.optJSONArray("reminders");
        if (arr == null) return new int[0];
        int[] out = new int[arr.length()];
        for (int i = 0; i < arr.length(); i++) out[i] = arr.optInt(i, 10);
        return out;
    }

    private void flush(ContentResolver cr, ArrayList<ContentProviderOperation> ops) throws Exception {
        if (ops.isEmpty()) return;
        ContentProviderResult[] r = cr.applyBatch(CalendarContract.AUTHORITY, ops);
        ops.clear();
        if (r == null) throw new IllegalStateException("applyBatch returned null");
    }

    /**
     * 一次落地全部差异：inserts / updates / deletes。
     * 事件与它的提醒放在同一批里，用 back reference 拿新事件的 id。
     */
    @PluginMethod
    public void apply(PluginCall call) {
        if (!has()) {
            call.reject("denied");
            return;
        }
        JSArray inserts = call.getArray("inserts", new JSArray());
        JSArray updates = call.getArray("updates", new JSArray());
        JSArray deletes = call.getArray("deletes", new JSArray());
        ContentResolver cr = getContext().getContentResolver();
        Uri evUri = asSync(Events.CONTENT_URI);
        Uri remUri = asSync(Reminders.CONTENT_URI);
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        int nIns = 0, nUpd = 0, nDel = 0;
        try {
            for (int i = 0; i < deletes.length(); i++) {
                long id = deletes.getLong(i);
                ops.add(ContentProviderOperation.newDelete(ContentUris.withAppendedId(evUri, id)).build());
                nDel++;
                if (ops.size() >= BATCH) flush(cr, ops);
            }
            for (int i = 0; i < updates.length(); i++) {
                JSONObject it = updates.getJSONObject(i);
                long id = it.getLong("id");
                int[] mins = minutes(it);
                ops.add(ContentProviderOperation.newUpdate(ContentUris.withAppendedId(evUri, id))
                        .withValues(eventValues(it.getLong("calendarId"), it.getJSONObject("event"), it.getString("key"), it.getString("hash"), mins.length > 0))
                        .build());
                ops.add(ContentProviderOperation.newDelete(remUri)
                        .withSelection(Reminders.EVENT_ID + "=?", new String[]{ String.valueOf(id) })
                        .build());
                for (int m : mins) {
                    ops.add(ContentProviderOperation.newInsert(remUri)
                            .withValue(Reminders.EVENT_ID, id)
                            .withValue(Reminders.MINUTES, m)
                            .withValue(Reminders.METHOD, Reminders.METHOD_ALERT)
                            .build());
                }
                nUpd++;
                if (ops.size() >= BATCH) flush(cr, ops);
            }
            for (int i = 0; i < inserts.length(); i++) {
                JSONObject it = inserts.getJSONObject(i);
                int[] mins = minutes(it);
                // 一个事件带它的提醒必须在同一批：back reference 只在批内有效
                if (ops.size() + 1 + mins.length > BATCH) flush(cr, ops);
                int ref = ops.size();
                ops.add(ContentProviderOperation.newInsert(evUri)
                        .withValues(eventValues(it.getLong("calendarId"), it.getJSONObject("event"), it.getString("key"), it.getString("hash"), mins.length > 0))
                        .build());
                for (int m : mins) {
                    ops.add(ContentProviderOperation.newInsert(remUri)
                            .withValueBackReference(Reminders.EVENT_ID, ref)
                            .withValue(Reminders.MINUTES, m)
                            .withValue(Reminders.METHOD, Reminders.METHOD_ALERT)
                            .build());
                }
                nIns++;
            }
            flush(cr, ops);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
            return;
        }
        JSObject o = new JSObject();
        o.put("inserted", nIns);
        o.put("updated", nUpd);
        o.put("deleted", nDel);
        call.resolve(o);
    }

    /** 账户下的日历全部删掉（Provider 级联删事件与提醒） */
    @PluginMethod
    public void removeAll(PluginCall call) {
        if (!has()) {
            call.resolve();
            return;
        }
        ContentResolver cr = getContext().getContentResolver();
        for (Long id : findCalendars().values()) {
            try {
                cr.delete(asSync(ContentUris.withAppendedId(Calendars.CONTENT_URI, id)), null, null);
            } catch (Exception ignored) {
            }
        }
        call.resolve();
    }

    /** 这台设备有没有能打开日历的应用 */
    @PluginMethod
    public void hasCalendarApp(PluginCall call) {
        JSObject o = new JSObject();
        o.put("available", viewIntent(System.currentTimeMillis()).resolveActivity(getContext().getPackageManager()) != null);
        call.resolve(o);
    }

    private Intent viewIntent(long at) {
        Uri.Builder b = CalendarContract.CONTENT_URI.buildUpon();
        b.appendPath("time");
        ContentUris.appendId(b, at);
        return new Intent(Intent.ACTION_VIEW).setData(b.build());
    }

    /** 打开系统日历到某一天（默认今天） */
    @PluginMethod
    public void openCalendar(PluginCall call) {
        long at = call.getLong("at", System.currentTimeMillis());
        try {
            Intent i = viewIntent(at);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("no calendar app");
        }
    }

    /** 权限被永久拒绝后，去应用详情页手动允许 */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.fromParts("package", getContext().getPackageName(), null))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("no settings");
        }
    }

    /** 在系统日历里打开某一条事件 */
    @PluginMethod
    public void openEvent(PluginCall call) {
        long id = call.getLong("id", -1L);
        if (id < 0) {
            call.reject("bad id");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW).setData(ContentUris.withAppendedId(Events.CONTENT_URI, id));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("no calendar app");
        }
    }
}
