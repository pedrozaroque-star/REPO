/**
 * @module api/careers
 * @description Retired careers endpoint for Tacos Gavilan.
 * Careers and job applications are currently not active on this site.
 * Responds with HTTP 410 Gone and helpful contact guidance.
 */

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(410).json({
        success: false,
        error: 'CAREERS_NOT_ACTIVE',
        message: 'Online employment applications are currently not active. Please visit our Contact page or email info@tacosgavilan.com for assistance.'
    });
};
