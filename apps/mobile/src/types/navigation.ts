import type { NavigatorScreenParams } from '@react-navigation/native'

export type MainTabParamList = {
  Home: undefined
  Chat: { conversationId?: number } | undefined
  Knowledge: undefined
  Skills: undefined
  Profile: undefined
}

export type RootStackParamList = {
  Login: undefined
  Main: NavigatorScreenParams<MainTabParamList> | undefined
  Tasks: undefined
  Usage: undefined
  FeedbackAdmin: undefined
}
