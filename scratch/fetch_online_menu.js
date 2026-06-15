async function fetchOnlineMenu() {
    try {
        const url = 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119?pickup=true&utm_source=sdk';
        console.log(`Fetching ${url} with custom browser headers...`);
        
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1'
            }
        });
        
        console.log(`Response Status: ${res.status} ${res.statusText}`);
        const html = await res.text();
        console.log(`HTML Length: ${html.length} characters`);
        
        // Write the HTML to a file to analyze
        const fs = require('fs');
        const path = require('path');
        const outputPath = path.join(__dirname, 'online_menu_raw.html');
        fs.writeFileSync(outputPath, html, 'utf8');
        console.log(`Saved raw HTML to ${outputPath}`);
        
        // Check if we got Cloudflare challenge page
        if (html.includes('cloudflare') || html.includes('cf-challenge')) {
            console.log('⚠️ Detected Cloudflare challenge/protection page.');
        } else {
            console.log('✅ Successfully loaded page without Cloudflare block!');
        }
    } catch (e) {
        console.error('Error fetching online menu:', e);
    }
}

fetchOnlineMenu();
