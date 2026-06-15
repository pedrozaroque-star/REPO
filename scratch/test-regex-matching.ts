const html = `<div><bc-attachment content-type="image/png" url="https://preview.app.basecamp.com/5052386/blobs/afddbd48-28bf-11f1-a44e-0242ac120004/previews/full"><figure><img srcset="https://preview.app.basecamp.com/... 2x" loading="eager" src="https://preview.app.basecamp.com/5052386/blobs/afddbd48-28bf-11f1-a44e-0242ac120004/previews/full"><figcaption>image.png</figcaption></figure></bc-attachment></div>`;

const rewriteHtmlUrls = (html) => {
    if (!html) return ''
    
    // Step 1: Remove srcset attributes entirely
    let rewritten = html.replace(/\s+srcset="[^"]*"/gi, '')
    rewritten = rewritten.replace(/\s+srcset='[^']*'/gi, '')
    
    // Step 2: Rewrite Basecamp image src URLs to our proxy
    rewritten = rewritten.replace(
        /(<img[^>]+src=["'])(https:\/\/(?:preview\.app\.basecamp\.com|storage\.app\.basecamp\.com|3\.basecampapi\.com)[^"']+)((?:["'])[^\/>]*\/?>)/gi,
        (match, p1, p2, p3) => {
            return `${p1}/api/basecamp/attachment?url=${encodeURIComponent(p2)}${p3}`
        }
    )
    
    // Step 3: Rewrite Basecamp link href URLs to our proxy
    rewritten = rewritten.replace(
        /(<a[^>]+href=["'])(https:\/\/(?:preview\.app\.basecamp\.com|storage\.app\.basecamp\.com|3\.basecampapi\.com)[^"']+)((?:["'])[^\/>]*\/?>)/gi,
        (match, p1, p2, p3) => {
            return `${p1}/api/basecamp/attachment?url=${encodeURIComponent(p2)}${p3}`
        }
    )
    
    return rewritten
}

console.log('REWRITTEN:', rewriteHtmlUrls(html));
