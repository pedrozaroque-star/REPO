/**
 * @module scripts/tsx-user-info-fallback
 * @description Permite ejecutar pruebas locales TSX cuando Windows falla al consultar os.userInfo.
 * @businessRules Solo sustituye la consulta de usuario si la llamada nativa lanza un error; no modifica datos de negocio.
 * @dataFlow Node preload -> os.userInfo nativo o fallback del usuario de entorno -> arranque de tsx.
 * @notes Workaround limitado al proceso de prueba; no instalar globalmente ni usar para autenticar usuarios.
 */

const os = require('node:os')
const nativeUserInfo = os.userInfo
os.userInfo = function userInfoWithFallback(options) {
  try { return nativeUserInfo(options) }
  catch (error) {
    if (error?.code !== 'ERR_SYSTEM_ERROR') throw error
    const username = process.env.USERNAME || process.env.USER || 'local-test-user'
    return { username, uid: -1, gid: -1, shell: null, homedir: os.homedir() }
  }
}
