import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email es requerido' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Get JWT secret ready
    const rawSecret = JWT_SECRET.trim().replace(/^"(.*)"$/, '$1')
    const secret = rawSecret.length === 88 || rawSecret.includes('+') || rawSecret.includes('/')
      ? Buffer.from(rawSecret, 'base64')
      : rawSecret

    // ============================================
    // STEP 1: Check USERS table (admins/managers)
    // ============================================
    const usersResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=ilike.${encodeURIComponent(normalizedEmail)}&select=*&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    )

    const users = await usersResponse.json()

    if (users && users.length > 0) {
      const user = users[0]

      // User found in users table - require password
      if (!password) {
        return NextResponse.json(
          { error: 'Contraseña requerida para este usuario' },
          { status: 400 }
        )
      }

      // Verify user is active
      if (!user.is_active) {
        return NextResponse.json(
          { error: 'Usuario inactivo. Contacta al administrador.' },
          { status: 403 }
        )
      }

      // Validate password (plain text for now, should use bcrypt in production)
      if (user.password !== password) {
        return NextResponse.json(
          { error: 'Credenciales incorrectas' },
          { status: 401 }
        )
      }

      // Generate JWT token (7 days for admin/manager)
      const token = jwt.sign(
        {
          sub: String(user.id),
          aud: 'authenticated',
          role: 'authenticated',
          email: user.email,
          user_role: user.role,
          user_type: 'admin', // Mark as admin user
          user_metadata: {
            full_name: user.full_name,
            role: user.role,
            store_scope: user.store_scope,
            store_id: user.store_id
          }
        },
        secret,
        {
          algorithm: 'HS256',
          expiresIn: '7d'
        }
      )

      // Update last_login
      await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ last_login: new Date().toISOString() })
        }
      )

      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.full_name,
          role: user.role,
          store_scope: user.store_scope,
          store_id: user.store_id,
          user_type: 'admin'
        },
        token
      })
    }

    // ============================================
    // STEP 2: Check TOAST_EMPLOYEES table (employees)
    // ============================================
    const employeesResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/toast_employees?email=ilike.${encodeURIComponent(normalizedEmail)}&deleted=eq.false&select=id,toast_guid,first_name,last_name,email,store_ids&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    )

    const employees = await employeesResponse.json()

    if (employees && employees.length > 0) {
      const employee = employees[0]

      // Employee found - require password "Gavilan123"
      const EMPLOYEE_PASSWORD = 'Gavilan123'

      if (!password) {
        return NextResponse.json(
          { error: 'Contraseña requerida' },
          { status: 400 }
        )
      }

      if (password !== EMPLOYEE_PASSWORD) {
        return NextResponse.json(
          { error: 'Credenciales incorrectas' },
          { status: 401 }
        )
      }

      // Get employee's job/position from job_references in toast_employees
      let position_type: 'kitchen' | 'cashier' | null = null

      console.log(`🔍 Looking up jobs for employee: ${employee.id} (${employee.first_name} ${employee.last_name})`)

      // First, get the employee's job_references
      const empResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/toast_employees?id=eq.${employee.id}&select=job_references`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        }
      )

      const empData = await empResponse.json()
      const jobRefs = empData?.[0]?.job_references || []
      console.log(`🔍 Job references:`, JSON.stringify(jobRefs))

      if (jobRefs.length > 0) {
        // Get the first job's guid and look up its title
        const firstJobGuid = jobRefs[0]?.guid
        if (firstJobGuid) {
          const jobResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/toast_jobs?guid=eq.${firstJobGuid}&select=title`,
            {
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
              }
            }
          )
          const jobData = await jobResponse.json()
          const jobTitle = jobData?.[0]?.title?.toLowerCase() || ''
          console.log(`🔍 Job title found: "${jobTitle}"`)

          if (jobTitle.includes('cook') || jobTitle.includes('cocinero') || jobTitle.includes('kitchen') || jobTitle.includes('prep') || jobTitle.includes('preparador')) {
            position_type = 'kitchen'
          } else if (jobTitle.includes('cashier') || jobTitle.includes('cajero') || jobTitle.includes('register')) {
            position_type = 'cashier'
          }
          console.log(`🔍 Position type detected: ${position_type}`)
        }
      } else {
        console.log(`⚠️ No job_references found for employee ${employee.id}`)
      }

      // Determine shift_type (AM/PM) based on punch history
      let shift_type: 'AM' | 'PM' | null = null

      // Get punches from last 30 days for this employee
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]

      const punchesResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/punches?employee_toast_guid=eq.${employee.toast_guid}&business_date=gte.${thirtyDaysAgoStr}&clock_in=not.is.null&select=clock_in`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        }
      )

      const punches = await punchesResponse.json()
      console.log(`🕐 Found ${punches?.length || 0} punches in last 30 days for shift_type calculation`)

      if (punches && punches.length >= 3) {
        // Calculate average clock-in hour (in local time)
        let totalMinutes = 0
        let validPunches = 0

        for (const punch of punches) {
          if (punch.clock_in) {
            const clockIn = new Date(punch.clock_in)
            // Convert to LA time
            const laTimeStr = clockIn.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
            const laTime = new Date(laTimeStr)
            const hour = laTime.getHours()
            const minutes = laTime.getMinutes()
            const totalMins = hour * 60 + minutes

            // Only count punches that are "normal" (6am to 10pm range)
            if (totalMins >= 360 && totalMins <= 1320) { // 6am to 10pm
              totalMinutes += totalMins
              validPunches++
            }
          }
        }

        if (validPunches >= 3) {
          const avgMinutes = totalMinutes / validPunches
          const avgHour = avgMinutes / 60

          // Threshold: 3pm (15:00 = 900 minutes)
          if (avgMinutes < 900) {
            shift_type = 'AM'
          } else {
            shift_type = 'PM'
          }

          console.log(`🕐 Average clock-in time: ${Math.floor(avgHour)}:${String(Math.round(avgMinutes % 60)).padStart(2, '0')} → shift_type: ${shift_type}`)
        } else {
          console.log(`⚠️ Not enough valid punches (${validPunches}) to determine shift_type`)
        }
      } else {
        console.log(`⚠️ Not enough punches (${punches?.length || 0}) to determine shift_type`)
      }

      // Generate JWT token (15 MINUTES for employees)
      const token = jwt.sign(
        {
          sub: employee.id,
          aud: 'authenticated',
          role: 'authenticated',
          email: employee.email,
          user_role: 'employee',
          user_type: 'employee',
          position_type: position_type,
          shift_type: shift_type, // AM/PM based on punch history
          user_metadata: {
            full_name: `${employee.first_name} ${employee.last_name}`.trim(),
            role: 'employee',
            store_ids: employee.store_ids,
            toast_guid: employee.toast_guid,
            position_type: position_type,
            shift_type: shift_type
          }
        },
        secret,
        {
          algorithm: 'HS256',
          expiresIn: '15m'
        }
      )

      return NextResponse.json({
        success: true,
        user: {
          id: employee.id,
          email: employee.email,
          name: `${employee.first_name} ${employee.last_name}`.trim(),
          role: 'employee',
          store_ids: employee.store_ids,
          user_type: 'employee',
          position_type: position_type,
          shift_type: shift_type // Include for frontend filtering
        },
        token,
        redirect: '/mis-horarios'
      })
    }

    // ============================================
    // STEP 3: No user found in either table
    // ============================================
    return NextResponse.json(
      { error: 'No se encontró una cuenta con este correo' },
      { status: 401 }
    )

  } catch (error) {
    console.error('Error en login:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}