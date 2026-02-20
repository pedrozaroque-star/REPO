
import { NextResponse } from 'next/server';
import { authClient } from '@/lib/quickbooks';
import OAuthClient from 'intuit-oauth';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const authUri = authClient.authorizeUri({
            scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
            state: 'diagnose-init',
        });

        const html = `
        <html>
            <body style="font-family: sans-serif; padding: 20px;">
                <h1>QuickBooks Connection Diagnostics</h1>
                <div style="background: #f0f0f0; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                    <h3>Current Configuration:</h3>
                    <p><strong>Environment:</strong> ${process.env.QUICKBOOKS_ENVIRONMENT}</p>
                    <p><strong>Client ID:</strong> ${process.env.QUICKBOOKS_CLIENT_ID?.substring(0, 5)}...</p>
                    <p><strong>Redirect URI (Configured in App):</strong> ${process.env.QUICKBOOKS_REDIRECT_URI}</p>
                </div>

                <div style="background: #e6f7ff; padding: 15px; border-radius: 5px; border: 1px solid #91d5ff;">
                    <h3>Action Required:</h3>
                    <p>Please compare the Redirect URI above <strong>EXACTLY</strong> with what you have in the Intuit Portal (Production Tab).</p>
                    <p>If they match, click the button below to try connecting manually:</p>
                    <a href="${authUri}" style="display: inline-block; background: #0077c5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Connect to QuickBooks</a>
                </div>

                <div style="margin-top: 20px; font-size: 12px; color: #666; word-break: break-all;">
                    <p><strong>Generated Link (Debug):</strong><br/>${authUri}</p>
                </div>
            </body>
        </html>
        `;

        return new NextResponse(html, {
            headers: { 'Content-Type': 'text/html' },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
}
