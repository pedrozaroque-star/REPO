import fs from 'fs'
import path from 'path'

function parseGrid() {
  const html = fs.readFileSync('cohesion_dump/company_setup/sub_2_MyWorkflowsSales_Main.html', 'utf-8')
  
  // Regex to find store rows and packet review links
  // <a href="/MyWorkflows/PacketReview?...SiteId=2248&amp;PacketId=2368669...PostingDate=09%2F01%2F2026...PacketStatus=Published..."
  const linkRegex = /href="(\/MyWorkflows\/PacketReview\?[^"]+)"/g
  let match
  const packets: any[] = []

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = match[1].replace(/&amp;/g, '&')
    const url = new URL('https://cohesion4restaurants.com' + rawUrl)
    const siteId = url.searchParams.get('SiteId')
    const packetId = url.searchParams.get('PacketId')
    const postingDate = url.searchParams.get('PostingDate')?.split(' ')[0]
    const status = url.searchParams.get('PacketStatus')

    if (packetId && packetId !== '0') {
      packets.push({ siteId, packetId, postingDate, status })
    }
  }

  console.log(`Total paquetes encontrados en la cuadrícula de Cohesion: ${packets.length}`)
  console.log(packets.slice(0, 20))
  fs.writeFileSync('cohesion_dump/available_packets.json', JSON.stringify(packets, null, 2))
}

parseGrid()
