export const getEmbeddableImageUrl = (url: string) => {
    if (!url) return ''
    if (url.includes('lh3.googleusercontent.com')) return url

    try {
        let id = ''
        const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
        if (idMatch) {
            id = idMatch[1]
        } else if (url.includes('/file/d/')) {
            const parts = url.split('/file/d/')
            if (parts.length > 1) {
                id = parts[1].split('/')[0]
            }
        }

        if (id) {
            return `https://lh3.googleusercontent.com/d/${id}`
        }
    } catch (e) {
        console.error('Error parsing Drive URL:', e)
    }
    return url
}
