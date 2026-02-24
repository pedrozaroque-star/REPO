import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import QuickBooks from 'node-quickbooks'
import OAuthClient from 'intuit-oauth'

config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const authClient = new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID!,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
    environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
})

async function main() {
    try {
        console.log('1. Fetching integration record...')
        const { data: integration, error } = await supabase
            .from('integrations')
            .select('*')
            .eq('service_name', 'quickbooks')
            .single()

        if (error) throw error
        if (!integration) throw new Error('No QB integration found')

        console.log('Got integration:', integration.realm_id)

        // 2. Refresh Token
        let accessToken = integration.access_token
        try {
            console.log('2. Refreshing token...')
            const authResponse = await authClient.refreshUsingToken(integration.refresh_token)
            const tokens = authResponse.getJson()
            accessToken = tokens.access_token
            console.log('✅ Token renovado exitosamente.')
        } catch (refreshError: any) {
            console.error('Error refreshing token:', refreshError.authResponse ? refreshError.authResponse.json : refreshError.message)
            // Continue with old token to see if it works despite refresh failure
        }

        // 3. Initialize QB
        console.log('3. Initializing QuickBooks Client...')
        const qbo = new QuickBooks(
            process.env.QUICKBOOKS_CLIENT_ID,
            process.env.QUICKBOOKS_CLIENT_SECRET,
            accessToken,
            false,
            integration.realm_id,
            process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true,
            false, // debug
            null,
            '2.0',
            integration.refresh_token
        )

        // 4. Fetch QB Items
        console.log('4. Fetching Items from Quickbooks API...')
        const qbItems = await new Promise<any[]>((resolve, reject) => {
            qbo.findItems({ active: true }, (err: any, result: any) => {
                if (err) {
                    console.error('QB API Error:', err)
                    reject(err)
                } else {
                    resolve(result?.QueryResponse?.Item || [])
                }
            })
        })

        console.log('✅ Synchronized successfully:', qbItems.length, 'items found.')
    } catch (e: any) {
        console.error('Test Failed:', e.message || e)
    }
}

main().catch(console.error)
