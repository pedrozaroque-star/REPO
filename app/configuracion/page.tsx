'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useAuth } from '@/components/ProtectedRoute'
import { getSupabaseClient } from '@/lib/supabase'
import { useLanguage } from '@/lib/i18n'
import SurpriseLoader from '@/components/SurpriseLoader'
import {
  User, Mail, Lock, Phone, Shield, Eye, EyeOff, CheckCircle2,
  AlertCircle, Save, ArrowLeft, Store, Calendar, Info
} from 'lucide-react'

function SettingsPage() {
  const router = useRouter()
  const { user: authUser } = useAuth()
  const { t, language } = useLanguage()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  // User data fetched from DB
  const [dbUser, setDbUser] = useState<any>(null)

  // Profile form
  const [profile, setProfile] = useState({
    full_name: '',
    email: '',
    phone: '',
  })

  // Password form
  const [passwords, setPasswords] = useState({
    new_password: '',
    confirm_password: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [passMatchError, setPassMatchError] = useState('')

  // Labels
  const labels = language === 'es' ? {
    title: 'Configuración',
    subtitle: 'Administra tu perfil y credenciales de acceso',
    profile_title: 'Información Personal',
    profile_desc: 'Actualiza tu nombre y teléfono de contacto',
    full_name: 'Nombre Completo',
    email: 'Correo Electrónico',
    email_hint: 'El correo no se puede modificar desde aquí. Contacta a un administrador.',
    phone: 'Teléfono',
    role: 'Rol',
    store: 'Tienda Asignada',
    member_since: 'Miembro Desde',
    save_profile: 'Guardar Cambios',
    saving: 'Guardando...',
    profile_saved: '¡Perfil actualizado correctamente!',
    security_title: 'Seguridad',
    security_desc: 'Cambia tu contraseña de acceso al sistema',
    new_password: 'Nueva Contraseña',
    confirm_password: 'Confirmar Contraseña',
    password_placeholder: 'Mínimo 6 caracteres',
    confirm_placeholder: 'Repite la nueva contraseña',
    change_password: 'Cambiar Contraseña',
    updating: 'Actualizando...',
    password_changed: '¡Contraseña actualizada correctamente!',
    pass_mismatch: 'Las contraseñas no coinciden',
    pass_short: 'La contraseña debe tener al menos 6 caracteres',
    back: 'Volver',
    account_info: 'Información de Cuenta',
    status_active: 'Activo',
    status_inactive: 'Inactivo',
  } : {
    title: 'Settings',
    subtitle: 'Manage your profile and access credentials',
    profile_title: 'Personal Information',
    profile_desc: 'Update your name and contact phone number',
    full_name: 'Full Name',
    email: 'Email Address',
    email_hint: 'Email cannot be modified from here. Contact an administrator.',
    phone: 'Phone',
    role: 'Role',
    store: 'Assigned Store',
    member_since: 'Member Since',
    save_profile: 'Save Changes',
    saving: 'Saving...',
    profile_saved: 'Profile updated successfully!',
    security_title: 'Security',
    security_desc: 'Change your system access password',
    new_password: 'New Password',
    confirm_password: 'Confirm Password',
    password_placeholder: 'Minimum 6 characters',
    confirm_placeholder: 'Repeat new password',
    change_password: 'Change Password',
    updating: 'Updating...',
    password_changed: 'Password updated successfully!',
    pass_mismatch: 'Passwords do not match',
    pass_short: 'Password must be at least 6 characters',
    back: 'Back',
    account_info: 'Account Information',
    status_active: 'Active',
    status_inactive: 'Inactive',
  }

  // Load user data from Supabase on mount
  useEffect(() => {
    const loadUser = async () => {
      if (!authUser?.id) return
      try {
        const supabase = await getSupabaseClient()
        const { data, error } = await supabase
          .from('users')
          .select('*, stores:store_id(name)')
          .eq('id', authUser.id)
          .single()

        if (error) throw error
        if (data) {
          setDbUser(data)
          setProfile({
            full_name: data.full_name || '',
            email: data.email || '',
            phone: data.phone || '',
          })
        }
      } catch (err) {
        console.error('Error loading user:', err)
      } finally {
        setLoading(false)
      }
    }
    loadUser()
  }, [authUser])

  // Save profile
  const handleSaveProfile = async () => {
    setSaving(true)
    setProfileError('')
    setProfileSuccess(false)
    try {
      // Use the same API route as Usuarios module
      const response = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: dbUser.id,
          userData: {
            full_name: profile.full_name,
            phone: profile.phone,
          }
        })
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error)

      // Sync localStorage
      const stored = JSON.parse(localStorage.getItem('teg_user') || '{}')
      stored.full_name = profile.full_name
      stored.name = profile.full_name
      stored.phone = profile.phone
      localStorage.setItem('teg_user', JSON.stringify(stored))

      setDbUser((prev: any) => ({ ...prev, full_name: profile.full_name, phone: profile.phone }))
      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 4000)
    } catch (err: any) {
      setProfileError(err.message || 'Error updating profile')
    }
    setSaving(false)
  }

  // Change password
  const handleChangePassword = async () => {
    setPasswordError('')
    setPasswordSuccess(false)

    if (passwords.new_password.length < 6) {
      setPasswordError(labels.pass_short)
      return
    }
    if (passwords.new_password !== passwords.confirm_password) {
      setPasswordError(labels.pass_mismatch)
      return
    }

    setSavingPassword(true)
    try {
      // 1. Update password in public.users table (same as Usuarios module)
      const response = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: dbUser.id,
          userData: { password: passwords.new_password }
        })
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error)

      // 2. Also update via RPC if available
      try {
        const supabase = await getSupabaseClient()
        await supabase.rpc('update_user_password_plaintext', {
          target_user_id: dbUser.id,
          new_password: passwords.new_password
        })
      } catch (_) { /* Silent — RPC may not exist */ }

      setPasswords({ new_password: '', confirm_password: '' })
      setPasswordSuccess(true)
      setTimeout(() => setPasswordSuccess(false), 4000)
    } catch (err: any) {
      setPasswordError(err.message || 'Error updating password')
    }
    setSavingPassword(false)
  }

  // Password strength
  const passStrength = passwords.new_password.length === 0 ? 0
    : passwords.new_password.length < 6 ? 1
      : passwords.new_password.length < 10 ? 2 : 3
  const strengthColors = ['bg-slate-200 dark:bg-slate-700', 'bg-red-400', 'bg-yellow-400', 'bg-emerald-500']
  const strengthLabels = ['', 'Weak', 'Good', 'Strong']

  // Realtime password match validation
  const handlePasswordChange = (field: string, value: string) => {
    setPasswords(prev => ({ ...prev, [field]: value }))
    setPasswordError('')
    if (field === 'confirm_password' && value && passwords.new_password !== value) {
      setPassMatchError(labels.pass_mismatch)
    } else if (field === 'new_password' && passwords.confirm_password && value !== passwords.confirm_password) {
      setPassMatchError(labels.pass_mismatch)
    } else {
      setPassMatchError('')
    }
  }

  if (loading) return <SurpriseLoader />

  const storeName = dbUser?.stores?.name || (dbUser?.store_scope?.join(', ')) || '—'
  const memberDate = dbUser?.created_at ? new Date(dbUser.created_at).toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-3xl mx-auto px-4 py-6 md:py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => router.back()} className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">{labels.title}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-0.5">{labels.subtitle}</p>
          </div>
        </div>

        {/* Account Info Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 mb-6 shadow-sm">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4">{labels.account_info}</h3>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-red-500 to-orange-500 flex items-center justify-center text-white text-xl font-black shadow-lg ring-4 ring-white dark:ring-slate-900">
              {dbUser?.full_name?.[0] || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-black text-slate-900 dark:text-white truncate">{dbUser?.full_name || '—'}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{dbUser?.email}</p>
            </div>
            <div className="hidden sm:flex flex-col items-end gap-1.5">
              <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${dbUser?.is_active !== false ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30' : 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-100 dark:border-red-900/30'}`}>
                <Shield size={10} />
                {dbUser?.role?.toUpperCase()} • {dbUser?.is_active !== false ? labels.status_active : labels.status_inactive}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-600 font-medium flex items-center gap-1">
                <Calendar size={10} /> {memberDate}
              </span>
            </div>
          </div>
          {/* Mobile badges */}
          <div className="sm:hidden flex flex-wrap gap-2 mt-3">
            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30">
              <Shield size={10} /> {dbUser?.role}
            </span>
            <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
              <Store size={10} /> {storeName}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">

          {/* ═══ PROFILE SECTION ═══ */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
                  <User size={18} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-white">{labels.profile_title}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{labels.profile_desc}</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Full Name */}
              <div className="group">
                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1 group-focus-within:text-blue-600 transition-colors">{labels.full_name}</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-focus-within:text-blue-500 transition-colors" size={16} />
                  <input
                    type="text"
                    value={profile.full_name}
                    onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl outline-none transition-all font-bold text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Email (read-only) */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">{labels.email}</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600" size={16} />
                  <input type="email" value={profile.email} disabled className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 dark:text-slate-500 font-bold cursor-not-allowed" />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1.5 ml-1 font-medium flex items-center gap-1">
                  <Info size={10} /> {labels.email_hint}
                </p>
              </div>

              {/* Phone */}
              <div className="group">
                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1 group-focus-within:text-blue-600 transition-colors">{labels.phone}</label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-focus-within:text-blue-500 transition-colors" size={16} />
                  <input
                    type="tel"
                    value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl outline-none transition-all font-bold text-slate-900 dark:text-white"
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>

              {/* Success/Error */}
              {profileSuccess && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-sm font-bold animate-in fade-in duration-300">
                  <CheckCircle2 size={16} /> {labels.profile_saved}
                </div>
              )}
              {profileError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30 text-red-700 dark:text-red-400 text-sm font-bold">
                  <AlertCircle size={16} /> {profileError}
                </div>
              )}

              {/* Save Button */}
              <button
                onClick={handleSaveProfile}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black text-xs uppercase tracking-widest rounded-xl transition-all hover:bg-slate-800 dark:hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-slate-200 dark:shadow-none"
              >
                <Save size={14} />
                {saving ? labels.saving : labels.save_profile}
              </button>
            </div>
          </div>

          {/* ═══ SECURITY SECTION ═══ */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
                  <Lock size={18} className="text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-white">{labels.security_title}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{labels.security_desc}</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* New Password */}
              <div className="group">
                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">{labels.new_password}</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={16} />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={passwords.new_password}
                    onChange={(e) => handlePasswordChange('new_password', e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-800 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 rounded-xl outline-none transition-all font-bold text-slate-900 dark:text-white"
                    placeholder={labels.password_placeholder}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-500 transition-colors">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {/* Strength Bar */}
                {passwords.new_password && (
                  <div className="flex items-center gap-2 mt-2 px-1">
                    <div className="flex gap-1 flex-1">
                      {[1, 2, 3].map(level => (
                        <div key={level} className={`h-1.5 rounded-full flex-1 transition-all duration-300 ${passStrength >= level ? strengthColors[passStrength] : 'bg-slate-100 dark:bg-slate-800'}`} />
                      ))}
                    </div>
                    <span className={`text-[10px] font-bold ${passStrength <= 1 ? 'text-red-500' : passStrength === 2 ? 'text-yellow-500' : 'text-emerald-500'}`}>
                      {strengthLabels[passStrength]}
                    </span>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div className="group">
                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">{labels.confirm_password}</label>
                <div className="relative">
                  <CheckCircle2 className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors ${passwords.confirm_password && !passMatchError ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`} size={16} />
                  <input
                    type="password"
                    value={passwords.confirm_password}
                    onChange={(e) => handlePasswordChange('confirm_password', e.target.value)}
                    disabled={!passwords.new_password}
                    className={`w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800/50 border focus:ring-4 focus:ring-amber-500/10 rounded-xl outline-none transition-all font-bold text-slate-900 dark:text-white disabled:opacity-40 disabled:cursor-not-allowed ${passMatchError ? 'border-red-300 dark:border-red-900/50' : 'border-slate-100 dark:border-slate-700 focus:border-amber-500'}`}
                    placeholder={labels.confirm_placeholder}
                  />
                </div>
                {passMatchError && (
                  <div className="flex items-center gap-1 mt-1.5 ml-1 text-red-500 text-[10px] font-black uppercase tracking-widest">
                    <AlertCircle size={12} /> {passMatchError}
                  </div>
                )}
              </div>

              {/* Success/Error */}
              {passwordSuccess && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-sm font-bold animate-in fade-in duration-300">
                  <CheckCircle2 size={16} /> {labels.password_changed}
                </div>
              )}
              {passwordError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30 text-red-700 dark:text-red-400 text-sm font-bold">
                  <AlertCircle size={16} /> {passwordError}
                </div>
              )}

              {/* Change Password Button */}
              <button
                onClick={handleChangePassword}
                disabled={savingPassword || !passwords.new_password || !!passMatchError}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-amber-100 dark:shadow-none"
              >
                <Lock size={14} />
                {savingPassword ? labels.updating : labels.change_password}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ProtectedSettingsPage() {
  return (
    <ProtectedRoute allowEmployee={true}>
      <SettingsPage />
    </ProtectedRoute>
  )
}