package expo.modules.momentumalarm

import android.app.Activity
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

private const val CHANNEL = "alarms"
private const val PREFS = "momentum_alarm"
private const val IDS = "ids"

class Alarm : Record {
  @Field val id: String = ""
  @Field val at: Double = 0.0 // epoch ms
  @Field val title: String = ""
  @Field val body: String = ""
  @Field val url: String = "" // deep link opened by "Open"
}

private fun ensureChannel(c: Context) {
  val sound = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
  val ch = NotificationChannel(CHANNEL, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
    setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), sound)
    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    enableVibration(true)
  }
  c.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
}

/** Same intent (by filterEquals) when setting and cancelling: the id is in the data URI. */
private fun alarmIntent(c: Context, id: String) =
  PendingIntent.getBroadcast(
    c, 0,
    Intent(c, AlarmReceiver::class.java).setData(Uri.parse("momentum-alarm://$id")).putExtra("id", id),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

/** setAlarmClock is exact and needs no exact-alarm permission; the system also shows its alarm icon. */
private fun arm(c: Context, id: String, at: Long) {
  val show = PendingIntent.getActivity(c, 0, c.packageManager.getLaunchIntentForPackage(c.packageName), PendingIntent.FLAG_IMMUTABLE)
  c.getSystemService(AlarmManager::class.java).setAlarmClock(AlarmManager.AlarmClockInfo(at, show), alarmIntent(c, id))
}

/**
 * Posts the alarm notification. `ring` = full-screen intent plus a repeating sound (stops after a minute).
 * Without it this is a plain high-importance notification, used for alarms the phone slept through.
 */
private fun post(c: Context, id: String, ring: Boolean) {
  val prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  val title = prefs.getString("t:$id", "") ?: ""
  val body = prefs.getString("b:$id", "") ?: ""
  val url = prefs.getString("u:$id", "") ?: ""
  val nid = id.hashCode()
  ensureChannel(c)
  val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
  val open = PendingIntent.getActivity(c, nid, Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(c.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
  val b = Notification.Builder(c, CHANNEL)
    .setSmallIcon(android.R.drawable.ic_lock_idle_alarm) // ponytail: stock icon; use the app's notification icon if one is added
    .setContentTitle(title)
    .setContentText(body)
    .setCategory(Notification.CATEGORY_ALARM)
    .setContentIntent(open)
    .setAutoCancel(true)
  if (ring) {
    val screen = PendingIntent.getActivity(
      c, nid,
      Intent(c, AlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("nid", nid).putExtra("title", title).putExtra("body", body).putExtra("url", url),
      flags,
    )
    // Without the full-screen-intent permission the system shows this as a plain heads-up notification.
    b.setFullScreenIntent(screen, true).setTimeoutAfter(60_000) // stop ringing after a minute instead of until the battery dies
  }
  val n = b.build()
  if (ring) n.flags = n.flags or Notification.FLAG_INSISTENT // repeat the sound until cancelled
  c.getSystemService(NotificationManager::class.java).notify(nid, n)
}

class MomentumAlarmModule : Module() {
  private val ctx get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MomentumAlarm")

    Function("canUseFullScreenIntent") {
      Build.VERSION.SDK_INT < 34 || ctx.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
    }

    Function("openFullScreenIntentSettings") {
      if (Build.VERSION.SDK_INT >= 34) {
        ctx.startActivity(
          Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
    }

    Function("setAlarms") { alarms: List<Alarm> ->
      ensureChannel(ctx)
      val am = ctx.getSystemService(AlarmManager::class.java)
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      for (old in prefs.getStringSet(IDS, emptySet()).orEmpty()) am.cancel(alarmIntent(ctx, old))
      val edit = prefs.edit().clear()
      for (a in alarms) {
        arm(ctx, a.id, a.at.toLong())
        edit.putLong("a:${a.id}", a.at.toLong()).putString("t:${a.id}", a.title).putString("b:${a.id}", a.body).putString("u:${a.id}", a.url)
      }
      edit.putStringSet(IDS, alarms.map { it.id }.toSet()).apply()
    }
  }
}

/** The alarm time came: ring. */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) {
    post(c, i.getStringExtra("id") ?: return, ring = true)
  }
}

/**
 * AlarmManager forgets every alarm on reboot: re-arm the stored ones that are still ahead, and
 * post the ones that went off while the phone was off as a plain notification (MOB-07).
 * Needs RECEIVE_BOOT_COMPLETED; the stored alarms are replaced by the next setAlarms from the app.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) {
    if (i.action != Intent.ACTION_BOOT_COMPLETED) return
    val prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    for (id in prefs.getStringSet(IDS, emptySet()).orEmpty()) {
      val at = prefs.getLong("a:$id", 0L)
      if (at <= 0L) continue
      if (at > now) arm(c, id, at) else if (now - at < 24 * 3_600_000L) post(c, id, ring = false)
    }
  }
}

/** Shown over the lock screen: Open the task or Dismiss. Either one silences the alarm. */
class AlarmActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val nid = intent.getIntExtra("nid", 0)
    val url = intent.getStringExtra("url").orEmpty()
    fun stop() {
      getSystemService(NotificationManager::class.java).cancel(nid)
      finish()
    }
    fun label(text: String?, size: Float) = TextView(this).apply {
      this.text = text
      textSize = size
      gravity = Gravity.CENTER
      setPadding(0, 24, 0, 24)
    }
    setContentView(
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(48, 48, 48, 48)
        addView(label(intent.getStringExtra("title"), 32f))
        addView(label(intent.getStringExtra("body"), 18f))
        addView(
          Button(this@AlarmActivity).apply {
            text = "Open"
            setOnClickListener {
              startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(packageName))
              stop()
            }
          },
        )
        addView(Button(this@AlarmActivity).apply {
          text = "Dismiss"
          setOnClickListener { stop() }
        })
      },
    )
  }
}
