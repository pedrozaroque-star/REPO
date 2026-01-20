
import imageCompression from 'browser-image-compression'

/**
 * Compresses an image file to reduce size while maintaining acceptable quality.
 * Target: Max 1MB size, Max 1920px width/height.
 */
export async function compressImage(file: File): Promise<File> {
    // If NOT an image (e.g. video), return original
    if (!file.type.startsWith('image/')) {
        return file
    }

    const options = {
        maxSizeMB: 0.8,          // Max size ~800KB (plenty for high quality mobile photo)
        maxWidthOrHeight: 1600,  // Max dimension 1600px (HD is enough for audits)
        useWebWorker: true,      // Use separate thread to avoid freezing UI
        fileType: file.type as string // Maintain original format (jpeg/png)
    }

    try {
        const compressedFile = await imageCompression(file, options)
        console.log(`Image compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB -> ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`)
        return compressedFile
    } catch (error) {
        console.error('Image compression failed, using original file:', error)
        return file // Fallback to original if compression fails
    }
}
