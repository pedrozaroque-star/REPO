async function run() {
    const s3Url = 'https://storage.basecamp.com/bc4-production-blob-previews/6144628c-5fb4-11f1-9b75-46a2d7f1d0d3?response-cache-control=private%2C%20max-age%3D3155695200&response-content-disposition=inline&response-content-type=image%2Fjpeg&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=PSFBSAZROHOHENDNACPGDOPOONMFHLBHNMKOEBGFNK%2F20260604%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260604T014435Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=477cc8254ebf8e42e22e89fa8fb64e744b80d82a8ba616fb42b05ae47d264792'
    try {
        const res = await fetch(s3Url)
        console.log('S3 direct status:', res.status)
        console.log('S3 direct content-type:', res.headers.get('content-type'))
        if (!res.ok) {
            console.log('Response body:', await res.text())
        } else {
            console.log('Response is OK!')
        }
    } catch (e: any) {
        console.log('Error:', e.message)
    }
}
run()
