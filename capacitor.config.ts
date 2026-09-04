import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.timetable',
  appName: '嘎嘎课程表',
  webDir: 'dist',
  backgroundColor: '#F7F7F6',
  android: {
    backgroundColor: '#F7F7F6',
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
    StatusBar: {
      overlaysWebView: false,
    },
  },
}

export default config
