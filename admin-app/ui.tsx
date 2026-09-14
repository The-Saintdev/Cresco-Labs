import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import { FileText, Film, Image as ImageIcon, type LucideIcon } from 'lucide-react-native'
import { kindColor, radius, space, type Theme } from '@cresco/mobile-shared/tokens'
import { useThemeChoice } from './theme'

export type Kind = 'text' | 'image' | 'video'

export function useTheme(): Theme {
  return useThemeChoice().theme
}

export const kindIcon: Record<Kind, LucideIcon> = { text: FileText, image: ImageIcon, video: Film }

export function KindBadge({ kind, size = 34 }: { kind: Kind; size?: number }) {
  const theme = useTheme()
  const Icon = kindIcon[kind]
  return <View style={{ width: size, height: size, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bgSunken, borderWidth: 1, borderColor: theme.border }}>
    <Icon size={Math.round(size * 0.5)} color={kindColor(theme, kind)} />
  </View>
}

export function StatusPill({ status }: { status: 'complete' | 'failed' | 'queued' }) {
  const theme = useTheme()
  const tone = status === 'complete'
    ? { bg: theme.successWeak, fg: theme.success, label: 'Complete' }
    : status === 'failed'
      ? { bg: theme.dangerWeak, fg: theme.danger, label: 'Failed' }
      : { bg: theme.accentWeak, fg: theme.accent, label: 'Running' }
  return <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: tone.bg }}>
    <Text style={{ fontSize: 11, fontWeight: '600', color: tone.fg }}>{tone.label}</Text>
  </View>
}

export function Button({
  label, onPress, disabled, tone = 'primary', busy, icon: Icon, style,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
  busy?: boolean
  icon?: LucideIcon
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  const background = tone === 'primary' ? theme.accent : tone === 'danger' ? theme.dangerWeak : theme.bgRaised
  const foreground = tone === 'primary' ? theme.accentText : tone === 'danger' ? theme.danger : theme.text
  return <TouchableOpacity
    accessibilityRole="button"
    disabled={disabled || busy}
    onPress={onPress}
    activeOpacity={0.8}
    style={[{
      minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: background,
      borderWidth: tone === 'secondary' ? 1 : 0, borderColor: theme.border,
      opacity: disabled || busy ? 0.45 : 1,
    }, style]}
  >
    {busy ? <ActivityIndicator size="small" color={foreground} /> : Icon ? <Icon size={16} color={foreground} /> : null}
    <Text style={{ fontSize: 14, fontWeight: '600', color: foreground }}>{label}</Text>
  </TouchableOpacity>
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme()
  return <View style={[{ backgroundColor: theme.bgRaised, borderWidth: 1, borderColor: theme.border, borderRadius: radius.lg }, style]}>{children}</View>
}

export function Empty({ title, text }: { title: string; text: string }) {
  const theme = useTheme()
  return <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: space.xl, gap: 6 }}>
    <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>{title}</Text>
    <Text style={{ fontSize: 13, color: theme.textFaint, textAlign: 'center', lineHeight: 19 }}>{text}</Text>
  </View>
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  const theme = useTheme()
  return <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: theme.dangerWeak }}>
    <Text style={{ fontSize: 13, color: theme.danger, lineHeight: 19 }}>{children}</Text>
  </View>
}

export const sheet = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: space.lg, paddingBottom: 48 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, minWidth: 0 },
})

export function Row({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  const theme = useTheme()
  const content = <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg }}>{children}</View>
  if (!onPress) return <Card style={{ marginBottom: space.sm }}>{content}</Card>
  return <TouchableOpacity activeOpacity={0.8} onPress={onPress}><Card style={{ marginBottom: space.sm, borderColor: theme.border }}>{content}</Card></TouchableOpacity>
}

export function Field({
  label, value, onChange, placeholder, secure, hint, keyboard,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  secure?: boolean
  hint?: string
  keyboard?: 'default' | 'email-address' | 'decimal-pad'
}) {
  const theme = useTheme()
  return <View style={{ gap: 6 }}>
    <Text style={{ fontSize: 12, fontWeight: '500', color: theme.textMuted }}>{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.textFaint}
      secureTextEntry={secure}
      autoCapitalize={keyboard === 'email-address' ? 'none' : 'sentences'}
      keyboardType={keyboard === 'decimal-pad' ? 'decimal-pad' : keyboard === 'email-address' ? 'email-address' : 'default'}
      style={{
        minHeight: 46, color: theme.text, backgroundColor: theme.bgRaised,
        borderWidth: 1, borderColor: theme.border, borderRadius: radius.md,
        paddingHorizontal: space.md, fontSize: 15,
      }}
    />
    {hint ? <Text style={{ fontSize: 12, color: theme.textFaint }}>{hint}</Text> : null}
  </View>
}

export function Choice<T extends string>({ value, options, onChange }: { value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  const theme = useTheme()
  return <View style={{ flexDirection: 'row', padding: 3, gap: 3, borderRadius: radius.md, backgroundColor: theme.bgSunken }}>
    {options.map(option => (
      <TouchableOpacity
        key={option.value}
        accessibilityRole="tab"
        accessibilityState={{ selected: value === option.value }}
        onPress={() => onChange(option.value)}
        style={{ flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: value === option.value ? theme.bgRaised : 'transparent' }}
      >
        <Text style={{ fontSize: 12.5, fontWeight: value === option.value ? '600' : '400', color: value === option.value ? theme.text : theme.textMuted }}>{option.label}</Text>
      </TouchableOpacity>
    ))}
  </View>
}

export function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  const theme = useTheme()
  return <View style={{ marginTop: space.lg, marginBottom: space.md }}>
    <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>{title}</Text>
    {detail ? <Text style={{ fontSize: 12.5, color: theme.textFaint, marginTop: 3, lineHeight: 18 }}>{detail}</Text> : null}
  </View>
}
