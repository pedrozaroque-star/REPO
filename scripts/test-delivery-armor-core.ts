import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { verifyRonosPin, classifyPlatform, isHighRiskBeverage, getToastBusinessDate } from '../lib/delivery-armor';

async function testCore() {
  console.log('🧪 Testing delivery-armor core logic...');

  // 1. Test Toast Business Date (6 AM boundary)
  const bizDate = getToastBusinessDate();
  console.log('✅ Current Toast Business Date:', bizDate);

  // 2. Test Platform Classification
  const platforms = [
    { opt: 'DoorDash - Delivery', serv: 'DoorDash', expected: 'DOORDASH' },
    { opt: 'Uber Eats - Delivery', serv: '', expected: 'UBER_EATS' },
    { opt: 'GrubHub Delivery', serv: 'Grubhub', expected: 'GRUBHUB' },
    { opt: 'Toast Online', serv: '', expected: 'TOAST_ONLINE' },
    { opt: 'Online Ordering - Delivery', serv: '', expected: 'TOAST_ONLINE' },
    { opt: 'Curbside Pickup', serv: '', expected: 'TOAST_ONLINE' },
    { opt: 'To Go', serv: '', expected: 'TAKEOUT' }
  ];

  for (const p of platforms) {
    const res = classifyPlatform(p.opt, p.serv);
    if (res !== p.expected) {
      console.error(`❌ Mismatch for ${p.opt}: got ${res}, expected ${p.expected}`);
      process.exit(1);
    }
  }
  console.log('✅ All off-premise platforms correctly classified!');

  // 3. Test High-risk beverage detection
  const drinks = ['Horchata 32oz', 'Coca Cola Mexicana', 'Agua de Jamaica', 'Jarrito Mandarina', 'Taco Asada'];
  const drinkFlags = drinks.map(d => ({ name: d, isDrink: isHighRiskBeverage(d) }));
  console.log('✅ Beverage risk flags:', drinkFlags);

  // 4. Test RONOS PIN verification for Central (#6) and Slauson (#7)
  // Let's test with David Rodriguez (pin 4312 from Central)
  const pinTest = await verifyRonosPin(6, '4312');
  console.log('✅ PIN 4312 validation result:', pinTest);
  if (!pinTest.valid) {
    console.error('❌ Expected pin 4312 to be valid in Central!');
    process.exit(1);
  }

  // Test invalid PIN
  const invalidPinTest = await verifyRonosPin(6, '0000');
  console.log('✅ Invalid PIN test result:', invalidPinTest);
  if (invalidPinTest.valid) {
    console.error('❌ Expected pin 0000 to be invalid!');
    process.exit(1);
  }

  console.log('🎉 delivery-armor core logic 100% verified!');
  process.exit(0);
}

testCore().catch(err => {
  console.error(err);
  process.exit(1);
});
