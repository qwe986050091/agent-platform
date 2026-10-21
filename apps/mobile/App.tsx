import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator, type BottomTabBarButtonProps } from '@react-navigation/bottom-tabs'
import Ionicons from '@expo/vector-icons/Ionicons'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { AuthProvider, useAuth } from './src/auth'
import { setupNotificationHandler } from './src/notifications'
import { useNotifications } from './src/hooks/useNotifications'
import type { AppNotification } from './src/api'
import LoginScreen from './src/screens/LoginScreen'
import ChatScreen from './src/screens/ChatScreen'
import HomeScreen from './src/screens/HomeScreen'
import KnowledgeScreen from './src/screens/KnowledgeScreen'
import SkillsScreen from './src/screens/SkillsScreen'
import ProfileScreen from './src/screens/ProfileScreen'
import TasksScreen from './src/screens/TasksScreen'
import UsageScreen from './src/screens/UsageScreen'
import FeedbackAdminScreen from './src/screens/FeedbackAdminScreen'
import type { RootStackParamList, MainTabParamList } from './src/types/navigation'

const Stack = createNativeStackNavigator<RootStackParamList>()
const Tab = createBottomTabNavigator<MainTabParamList>()

const navigationRef = createNavigationContainerRef<RootStackParamList>()

// 前台通知展示行为（Expo Go 下 expo-notifications 不可用，内部懒加载并自动降级为应用内提示条）
void setupNotificationHandler()

/** focused/outline 双态 tab 图标助手 */
function tabIcon(focusedName: string, outlineName: string) {
  return function TabIcon({ color, size, focused }: { color: string; size: number; focused: boolean }) {
    return <Ionicons name={(focused ? focusedName : outlineName) as any} size={size} color={color} />
  }
}

/**
 * 自定义 Tab 按钮：
 * React Navigation 默认用 android_ripple={borderless:true}，圆形涟漪会溢出按钮边界、
 * 被 Tab 栏/窗口边缘裁掉，看起来是「被截断的圆」。这里改为有边界（borderless:false）
 * 的圆角涟漪，视觉完整、且保留按压反馈。
 */
function TabBarButton({ children, style, onPress, onLongPress, href: _href, ...rest }: BottomTabBarButtonProps) {
  return (
    <Pressable
      {...(rest as any)}
      onPress={onPress as any}
      onLongPress={onLongPress as any}
      android_ripple={{ color: 'rgba(77,134,255,0.12)', borderless: false }}
      style={[style as any, styles.tabButton]}
    >
      {children as any}
    </Pressable>
  )
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4d86ff',
        tabBarInactiveTintColor: '#8590a6',
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#e4ebf7' },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarHideOnKeyboard: true,
        tabBarButton: TabBarButton,
        sceneStyle: { backgroundColor: '#fff' },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: '首页', tabBarIcon: tabIcon('home', 'home-outline') }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{ title: '聊天', tabBarIcon: tabIcon('chatbubble-ellipses', 'chatbubble-ellipses-outline') }}
      />
      <Tab.Screen
        name="Knowledge"
        component={KnowledgeScreen}
        options={{ title: '知识库', tabBarIcon: tabIcon('book', 'book-outline') }}
      />
      <Tab.Screen
        name="Skills"
        component={SkillsScreen}
        options={{ title: '技能', tabBarIcon: tabIcon('apps', 'apps-outline') }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: '我的', tabBarIcon: tabIcon('person-circle', 'person-circle-outline') }}
      />
    </Tab.Navigator>
  )
}

/** 应用内通知提示条（系统通知不可用时就地提示，点击跳转任务会话） */
function NotifBanner({
  notification,
  onPress,
  onClose,
}: {
  notification: AppNotification
  onPress: () => void
  onClose: () => void
}) {
  return (
    <Pressable style={styles.banner} onPress={onPress}>
      <Ionicons name="notifications" size={18} color="#4d86ff" />
      <View style={styles.bannerMain}>
        <Text style={styles.bannerTitle} numberOfLines={1}>
          {notification.title}
        </Text>
        {notification.body ? (
          <Text style={styles.bannerBody} numberOfLines={2}>
            {notification.body}
          </Text>
        ) : null}
      </View>
      <Pressable hitSlop={10} onPress={onClose}>
        <Ionicons name="close" size={16} color="#8590a6" />
      </Pressable>
    </Pressable>
  )
}

function Root() {
  const { user, ready, refreshUser } = useAuth()
  const [banner, setBanner] = useState<AppNotification | null>(null)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void refreshUser()
  }, [refreshUser])

  useEffect(() => {
    return () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
    }
  }, [])

  function openTarget(n: AppNotification) {
    setBanner(null)
    const conv = n.targetConversationId
    if (conv != null && navigationRef.isReady()) {
      navigationRef.navigate('Main', { screen: 'Chat', params: { conversationId: conv } })
    }
  }

  useNotifications({
    enabled: !!user,
    onOpen: openTarget,
    onInApp: (n) => {
      setBanner(n)
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
      bannerTimer.current = setTimeout(() => setBanner(null), 6000)
    },
  })

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#4d86ff" />
      </View>
    )
  }

  return (
    <>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#fff' },
          }}
        >
          {user ? (
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen name="Tasks" component={TasksScreen} />
              <Stack.Screen name="Usage" component={UsageScreen} />
              <Stack.Screen name="FeedbackAdmin" component={FeedbackAdminScreen} />
            </>
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {banner ? (
        <NotifBanner
          notification={banner}
          onPress={() => openTarget(banner)}
          onClose={() => setBanner(null)}
        />
      ) : null}
    </>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  /** Tab 按钮：圆角 + 裁剪，让按压涟漪完整落在按钮内，避免出现「被截断的圆」 */
  tabButton: { borderRadius: 14, overflow: 'hidden' },
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4ebf7',
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#172b5c',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  bannerMain: { flex: 1 },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: '#1d2738' },
  bannerBody: { fontSize: 12, color: '#5f6c84', marginTop: 3 },
})
