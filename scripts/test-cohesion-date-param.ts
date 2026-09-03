import puppeteer from 'puppeteer'

async function testCohesionDateParam() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  await page.goto('https://cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' })
  await page.type('#Email', 'raquel@tacosgavilan.com')
  await page.type('#Password', 'Canasta213!')
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('button[type="submit"]')
  ])

  // Try requesting a specific posting date in January 2026
  const testUrl = 'https://cohesion4restaurants.com/MyWorkflows/RefreshPacketGroup?ViewIndexType=SevenPackets&PageOffset=0&PacketOffset=0&IncludeCurrentPackets=False&GroupCount=1&IsActiveTab=True&PacketGroupViewTypeTitle=Multi-Period%20View&IsLoading=False&SiteId=0&PacketId=0&PacketType=SalesOnly&PacketStatus=UnOpened&PacketReviewFilterType=None&PostingDate=01%2F15%2F2026%2000%3A00%3A00&CompanyId=1866'
  console.log(`Visitando: ${testUrl} ...`)
  await page.goto(testUrl, { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, 2000))

  const text = await page.evaluate(() => document.body.innerText)
  console.log('Snippet de respuesta:', text.substring(0, 500))

  await browser.close()
}

testCohesionDateParam()
