/** 全公司通讯录里的一个人：服务端 im/user/friend/search 的返回，或本地通讯录拼出来的同样结构 */
export type DirectoryPerson = {
  uid: string
  name: string
  /** 邮箱；前缀就是姓名拼音（如 gaozq） */
  account: string
  avatar: string
  department?: string
  title?: string
}

/** 本地匹配：姓名包含关键词，或邮箱前缀包含关键词；关键词带 @ 时也匹配整个邮箱。keyword 需已转小写 */
export const matchDirectoryPerson = (person: DirectoryPerson, keyword: string) => {
  if (!keyword) return false
  const account = person.account.toLowerCase()
  const localPart = account.split('@')[0]
  return (
    person.name.toLowerCase().includes(keyword) ||
    localPart.includes(keyword) ||
    (keyword.includes('@') && account.includes(keyword))
  )
}

/** 服务端结果排在前面（已按匹配程度排序，且含部门、职务），再补上服务端没返回的本地结果 */
export const mergeDirectoryPeople = (remote: DirectoryPerson[], local: DirectoryPerson[]) => {
  const seen = new Set(remote.map((person) => person.uid))
  return [...remote, ...local.filter((person) => !seen.has(person.uid))]
}
