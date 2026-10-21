import { version } from '../../package.json'

/** 控制台打印版本信息 */
export const consolePrint = () => {
  console.log(
    `%c SMJ ${version}`,
    'font-size:20px;border-left: 4px solid #034fbc;background: #d2dff6;font-family: Comic Sans MS, cursive;color:#581845;padding:10px;border-radius:4px;'
  )
}
