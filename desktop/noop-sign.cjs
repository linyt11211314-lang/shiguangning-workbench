/**
 * 空签名脚本（no-op sign）
 *
 * 用途：本环境没有 Windows 代码签名证书，而 electron-builder 默认会对
 * 生成的 .exe / 卸载程序做 Authenticode 签名（需下载 winCodeSign 工具）。
 * 沙箱无创建符号链接权限，winCodeSign 解压会失败。故提供此空签名钩子，
 * 让 electron-builder 直接返回原文件、跳过签名。
 *
 * 影响：安装包不会带数字签名，用户首次安装时 Windows SmartScreen 会提示
 * “未知发布者”，点“仍要运行”即可。属无证书的常规现象。
 *
 * @param {object} configuration electron-builder 配置
 * @param {object} options 含待签名文件路径 options.path
 * @returns {string} 原文件路径
 */
module.exports = async function noopSign(configuration, options) {
  return options && options.path;
};
