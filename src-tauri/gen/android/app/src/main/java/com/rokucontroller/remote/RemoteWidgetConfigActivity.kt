package com.rokucontroller.remote

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors

/**
 * Chooses the Roku a home-screen widget controls, from the devices the app has saved. The
 * launcher opens it when the widget is added and again from the widget's "reconfigure" control;
 * a widget whose Roku was forgotten opens it when tapped.
 */
class RemoteWidgetConfigActivity : AppCompatActivity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private val executor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Leaving without choosing must not add a widget that controls nothing.
        setResult(RESULT_CANCELED)

        widgetId = intent?.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        val manager = AppWidgetManager.getInstance(this)
        val provider = manager.getAppWidgetInfo(widgetId)?.provider
        if (provider?.className != RemoteWidgetProvider::class.java.name) {
            finish()
            return
        }
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))

        setContentView(R.layout.activity_widget_config)
        findViewById<Button>(R.id.config_open_app).setOnClickListener {
            packageManager.getLaunchIntentForPackage(packageName)?.let(::startActivity)
            finish()
        }

        executor.execute {
            val devices = WidgetStore.savedDevices(applicationContext).orEmpty()
            runOnUiThread { showDevices(devices) }
        }
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    private fun showDevices(devices: List<WidgetDevice>) {
        if (isFinishing || isDestroyed) {
            return
        }
        val message = findViewById<TextView>(R.id.config_message)
        if (devices.isEmpty()) {
            message.setText(R.string.widget_config_empty)
            findViewById<View>(R.id.config_open_app).visibility = View.VISIBLE
            return
        }

        message.visibility = View.GONE
        val current = WidgetStore.get(this, widgetId)?.hardwareId
        findViewById<ListView>(R.id.config_devices).apply {
            visibility = View.VISIBLE
            adapter = DeviceAdapter(this@RemoteWidgetConfigActivity, devices)
            choiceMode = ListView.CHOICE_MODE_SINGLE
            devices.indexOfFirst { it.hardwareId == current }.takeIf { it >= 0 }?.let {
                setItemChecked(it, true)
            }
            setOnItemClickListener { _, _, position, _ -> choose(devices[position]) }
        }
    }

    private fun choose(device: WidgetDevice) {
        WidgetStore.put(this, widgetId, device)
        RemoteWidgetProvider.render(applicationContext, AppWidgetManager.getInstance(this), widgetId)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }

    /** A Roku's name over its address. */
    private class DeviceAdapter(context: Context, devices: List<WidgetDevice>) :
        ArrayAdapter<WidgetDevice>(context, R.layout.widget_config_device_row, android.R.id.text1, devices) {
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = super.getView(position, convertView, parent)
            val device = getItem(position) ?: return view
            view.findViewById<TextView>(android.R.id.text1).text = device.name
            view.findViewById<TextView>(android.R.id.text2).text = device.ip
            return view
        }
    }
}
