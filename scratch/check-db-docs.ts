import { supabaseAdmin } from '../lib/supabase';

async function main() {
    console.log('Checking database records...');
    
    // Check bc_documents
    const { data: docs, error: dErr } = await supabaseAdmin
        .from('bc_documents')
        .select('*')
        .limit(100);
        
    console.log(`Documents count in DB: ${docs?.length || 0}`);
    const googleDocs = docs?.filter(d => d.content?.includes('google.com') || d.title?.includes('Google') || d.content?.includes('spreadsheet'));
    console.log(`Google-like documents count in DB: ${googleDocs?.length || 0}`);
    if (googleDocs && googleDocs.length > 0) {
        console.log('Sample Google Docs:', googleDocs.map(d => ({ title: d.title, contentSnippet: d.content?.slice(0, 200) })));
    }
    
    // Check bc_uploads
    const { data: uploads, error: uErr } = await supabaseAdmin
        .from('bc_uploads')
        .select('*')
        .limit(200);
        
    console.log(`Uploads count in DB: ${uploads?.length || 0}`);
    const googleUps = uploads?.filter(u => u.download_url?.includes('google.com') || u.filename?.includes('Google') || u.content_type?.includes('google'));
    console.log(`Google-like uploads count in DB: ${googleUps?.length || 0}`);
    if (googleUps && googleUps.length > 0) {
        console.log('Sample Google Uploads:', googleUps.map(u => ({ filename: u.filename, download_url: u.download_url, content_type: u.content_type })));
    }
}

main().catch(console.error);
