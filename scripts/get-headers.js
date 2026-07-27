const axios = require('axios');
(async () => {
    try {
        await axios.get('https://ywwwdcvgfculqmcfkihq.supabase.co');
    } catch (e) {
        if (e.response) {
            console.log('Headers:', e.response.headers);
        } else {
            console.error(e.message);
        }
    }
})();
