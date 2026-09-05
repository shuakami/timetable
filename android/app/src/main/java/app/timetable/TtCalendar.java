package app.timetable;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.ContentProviderResult;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
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

/**
 * 系统日历：应用自己的一本本地日历（ACCOUNT_TYPE_LOCAL），以 sync adapter 身份读写。
 * 课、作业、考试都是这本日历里的事件，提醒由系统日历发出；页面只算差异，这里只做落地。
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

    private boolean has() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject status(String s) {
        JSObject o = new JSObject();
        o.put("status", s);
        return o;
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        call.resolve(status(has() ? "granted" : "prompt"));
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (has()) {
            call.resolve(status("granted"));
            return;
        }
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

    /** 我们那本日历的 _ID；没有返回 -1 */
    private long findCalendar() {
        ContentResolver cr = getContext().getContentResolver();
        try (Cursor c = cr.query(
                Calendars.CONTENT_URI,
                new String[]{ Calendars._ID },
                Calendars.ACCOUNT_NAME + "=? AND " + Calendars.ACCOUNT_TYPE + "=?",
                new String[]{ ACCOUNT_NAME, ACCOUNT_TYPE },
                null)) {
            if (c != null && c.moveToFirst()) return c.getLong(0);
        } catch (Exception ignored) {
        }
        return -1;
    }

    /**
     * 找到或创建日历；顺带把显示名与颜色对齐到当前主题。
     * 本地日历必须以 sync adapter 身份插入，否则 Provider 拒绝。
     */
    @PluginMethod
    public void ensureCalendar(PluginCall call) {
        if (!has()) {
            call.reject("denied");
            return;
        }
        String name = call.getString("name", ACCOUNT_NAME);
        int color = parseColor(call.getString("color"), 0xFF3B6FE0);
        ContentResolver cr = getContext().getContentResolver();
        long id = findCalendar();
        try {
            if (id >= 0) {
                ContentValues v = new ContentValues();
                v.put(Calendars.CALENDAR_DISPLAY_NAME, name);
                v.put(Calendars.CALENDAR_COLOR, color);
                v.put(Calendars.VISIBLE, 1);
                v.put(Calendars.SYNC_EVENTS, 1);
                cr.update(asSync(ContentUris.withAppendedId(Calendars.CONTENT_URI, id)), v, null, null);
            } else {
                ContentValues v = new ContentValues();
                v.put(Calendars.ACCOUNT_NAME, ACCOUNT_NAME);
                v.put(Calendars.ACCOUNT_TYPE, ACCOUNT_TYPE);
                v.put(Calendars.NAME, "timetable");
                v.put(Calendars.CALENDAR_DISPLAY_NAME, name);
                v.put(Calendars.CALENDAR_COLOR, color);
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
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
            return;
        }
        JSObject o = new JSObject();
        o.put("id", id);
        call.resolve(o);
    }

    /** 日历里现有的全部事件：id + key + hash，页面拿去和期望集合比 */
    @PluginMethod
    public void readAll(PluginCall call) {
        if (!has()) {
            call.reject("denied");
            return;
        }
        long cal = call.getLong("calendarId", -1L);
        if (cal < 0) cal = findCalendar();
        JSArray out = new JSArray();
        if (cal >= 0) {
            ContentResolver cr = getContext().getContentResolver();
            try (Cursor c = cr.query(
                    asSync(Events.CONTENT_URI),
                    new String[]{ Events._ID, Events.SYNC_DATA1, Events.SYNC_DATA2 },
                    Events.CALENDAR_ID + "=? AND " + Events.DELETED + "=0",
                    new String[]{ String.valueOf(cal) },
                    null)) {
                while (c != null && c.moveToNext()) {
                    JSObject e = new JSObject();
                    e.put("id", c.getLong(0));
                    e.put("key", c.isNull(1) ? "" : c.getString(1));
                    e.put("hash", c.isNull(2) ? "" : c.getString(2));
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
        if (!ev.isNull("color")) v.put(Events.EVENT_COLOR, parseColor(ev.optString("color"), 0));
        else v.putNull(Events.EVENT_COLOR);
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
        long cal = call.getLong("calendarId", -1L);
        if (cal < 0) cal = findCalendar();
        if (cal < 0) {
            call.reject("no calendar");
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
                        .withValues(eventValues(cal, it.getJSONObject("event"), it.getString("key"), it.getString("hash"), mins.length > 0))
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
                        .withValues(eventValues(cal, it.getJSONObject("event"), it.getString("key"), it.getString("hash"), mins.length > 0))
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

    /** 整本日历删掉（Provider 级联删事件与提醒） */
    @PluginMethod
    public void removeAll(PluginCall call) {
        if (!has()) {
            call.resolve();
            return;
        }
        long id = findCalendar();
        if (id >= 0) {
            try {
                getContext().getContentResolver().delete(asSync(ContentUris.withAppendedId(Calendars.CONTENT_URI, id)), null, null);
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
