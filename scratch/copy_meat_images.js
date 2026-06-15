const fs = require('fs');
const path = require('path');

const srcBaseDir = 'C:\\Users\\pedro\\OneDrive\\Imágenes\\Gavilan';
const destDir = 'c:\\Users\\pedro\\Desktop\\gavilan-app-backend\\public\\images';

const folderMappings = [
    {
        folder: '1. TACOS',
        prefix: 'taco',
        files: {
            'Asada.jpg': 'asada.jpg',
            'Asada OK.jpg': 'asada.jpg',
            'Pastor.jpg': 'pastor.jpg',
            'Pollo.jpg': 'pollo.jpg',
            'Chorizo.jpg': 'chorizo.jpg',
            'Buche.jpg': 'buche.jpg',
            'Cabeza.jpg': 'cabeza.jpg',
            'Carnitas.jpg': 'carnitas.jpg',
            'Lengua.jpg': 'lengua.jpg',
            'Tripa.jpg': 'tripa.jpg',
            'Tacos vegie.jpg': 'veggie.jpg'
        }
    },
    {
        folder: '2. BURRITO',
        prefix: 'burrito',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'POLLO ok.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg',
            'BURRITO brc.jpg': 'brc.jpg',
            'huevo-asada.jpg': 'huevo-asada.jpg',
            'huevo-chorizo.jpg': 'huevo-chorizo.jpg',
            'huevo-jamon.jpg': 'huevo-jamon.jpg',
            'huevo-queso.jpg': 'huevo-queso.jpg',
            'huevo-salchicha.jpg': 'huevo-salchicha.jpg'
        }
    },
    {
        folder: '10. SUPER BURRITO',
        prefix: 'super-burrito',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg',
            'super BURRITO brc.jpg': 'brc.jpg'
        }
    },
    {
        folder: '3. MULITA',
        prefix: 'mulita',
        files: {
            'Mulita ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg'
        }
    },
    {
        folder: '9. SUPER MULITA',
        prefix: 'super-mulita',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg'
        }
    },
    {
        folder: '4. SOPES',
        prefix: 'sopes',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg'
        }
    },
    {
        folder: '6. TORTA',
        prefix: 'torta',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg',
            'MILANEZA.jpg': 'milaneza.jpg',
            'VEGIE.jpg': 'veggie.jpg',
            'huevo-asada.png': 'huevo-asada.png',
            'huevo-chorizo.png': 'huevo-chorizo.png',
            'huevo-jamon.png': 'huevo-jamon.png',
            'huevo.png': 'huevo.png'
        }
    },
    {
        folder: '7. QUESADILLA',
        prefix: 'quesadilla',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg'
        }
    },
    {
        folder: '11. SUPER QUESADILLA',
        prefix: 'super-quesadilla',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg'
        }
    },
    {
        folder: '8. PLATO',
        prefix: 'plato',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'ASADA OK.jpg': 'asada.jpg',
            'PLATO ASADA OK.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg',
            'MILANEZA.jpg': 'milaneza.jpg',
            'mexicana.jpg': 'mexicana.jpg',
            'huevos-SALCH.jpg': 'huevo-salchicha.jpg',
            'huevos-chorizo.jpg': 'huevo-chorizo.jpg',
            'huevos-ranch.jpg': 'huevo-ranchero.jpg',
            'HUEVOS-JAMON.jpg': 'huevo-jamon.jpg'
        }
    },
    {
        folder: '13. NACHOS',
        prefix: 'nachos',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg'
        }
    },
    {
        folder: '13. NACHOS',
        prefix: 'super-nachos',
        files: {
            'ASADA.jpg': 'asada.jpg',
            'PASTOR.jpg': 'pastor.jpg',
            'POLLO.jpg': 'pollo.jpg',
            'CHORIZO.jpg': 'chorizo.jpg',
            'BUCHE.jpg': 'buche.jpg',
            'CABEZA.jpg': 'cabeza.jpg',
            'CARNITAS.jpg': 'carnitas.jpg',
            'LENGUA.jpg': 'lengua.jpg'
        }
    }
];

function main() {
    console.log(`Starting migration of meat-specific images from ${srcBaseDir} to ${destDir}...`);
    
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        console.log(`Created destination dir: ${destDir}`);
    }

    let successCount = 0;
    let failCount = 0;

    folderMappings.forEach(({ folder, prefix, files }) => {
        const fullSrcFolder = path.join(srcBaseDir, folder);
        console.log(`\nProcessing folder: "${folder}" (Prefix: "${prefix}")`);

        if (!fs.existsSync(fullSrcFolder)) {
            console.error(`❌ Source folder does not exist: ${fullSrcFolder}`);
            failCount++;
            return;
        }

        Object.entries(files).forEach(([srcFile, destFile]) => {
            const srcPath = path.join(fullSrcFolder, srcFile);
            const finalDestName = `${prefix}-${destFile}`;
            const destPath = path.join(destDir, finalDestName);

            if (fs.existsSync(srcPath)) {
                try {
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`  ✅ Copied: "${srcFile}" ➡️ "${finalDestName}"`);
                    successCount++;
                } catch (err) {
                    console.error(`  ❌ Error copying "${srcFile}":`, err.message);
                    failCount++;
                }
            } else {
                // If it doesn't exist, log as warning
                console.warn(`  ⚠️ File not found: "${srcPath}"`);
            }
        });
    });

    console.log(`\n========================================================`);
    console.log(`MIGRATION COMPLETED!`);
    console.log(`Successfully copied: ${successCount} files.`);
    console.log(`Failed/Missing: ${failCount} files.`);
    console.log(`========================================================\n`);
}

main();
