import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createDashboardGithub, dashboardGithubRepositories, dashboardGithubOrganization } from '../utils/dashboard-github.mjs'
import { createDashboardService } from '../utils/dashboard-service.mjs'
import { dashboardCodeProfile, githubProfileLogin } from '../utils/dashboard-members.mjs'

const instant = Date.parse('2026-10-29T08:00:00Z')
const env = { DASHBOARD_GITHUB_ORG: 'SDUTVINCI' }
const repo = (name, id = 1, extra = {}) => ({ id, full_name: `SDUTVINCI/${name}`, private: false, fork: false, ...extra })
const person = (login = 'developer', count = 5) => ({ login, contributions: count, email: 'never-return@example.test' })
const event = (type = 'PushEvent', payload = {}) => ({ id:'1', type, public:true, created_at:'2026-10-29T07:00:00Z', actor:{ login:'developer', email:'never-return@example.test' }, payload })
const service = (json, options={}) => createDashboardGithub({ json, now:()=>instant, ...options })
const upstream = (url) => url.includes('/orgs/') ? [repo('robot')] : url.includes('/contributors') ? [person()] : [event()]

test('GitHub 地址严格白名单、去重，组织优先配置，错误地址不发请求', async () => {
  assert.deepEqual(dashboardGithubRepositories({DASHBOARD_GITHUB_REPOS:'SDUTVINCI/robot,https://github.com/SDUTVINCI/robot.git'}).map(row=>row.key),['sdutvinci/robot'])
  assert.equal(dashboardGithubOrganization({DASHBOARD_GITHUB_ORG:'https://github.com/SDUTVINCI/'}),'SDUTVINCI')
  let calls=0
  for(const source of ['https://github.com.evil.test/owner/repo','https://user:pass@github.com/owner/repo','owner/../repo','https://github.com/owner/repo?token=secret']) {
    const value=await service(async()=>{calls++;return []})({DASHBOARD_GITHUB_REPOS:source})
    assert.equal(value.configurationError,true)
  }
  assert.equal(calls,0)
  assert.equal((await service(upstream)({})).enabled,false)
})

test('公开组织目录、作者贡献和事件采用 GitHub API，输出不包含邮箱或载荷正文', async () => {
  const calls=[]
  const value=await service(async(url,options)=>{calls.push({url,options});return upstream(url)})(env)
  assert.equal(value.organization.name,'SDUTVINCI')
  assert.equal(value.contributors[0].name,'developer')
  assert.equal(value.contributors[0].count,5)
  assert.equal(value.events[0].action,'推送了代码')
  assert.equal(value.sources.length,1)
  assert.equal(calls.length,3)
  assert(calls.every(call=>call.url.startsWith('https://api.github.com/')))
  assert(calls[0].url.includes('type=public'))
  assert.equal(calls[0].options.headers['User-Agent'],'SDUT-Vinci-Dashboard')
  assert(!JSON.stringify(value).includes('never-return'))
})

test('贡献榜完整分页超过100位作者，同一 GitHub 账号跨仓合并', async () => {
  const calls=[]
  const value=await service(async url=>{
    calls.push(url)
    if(url.includes('/orgs/'))return [repo('a'),repo('b',2)]
    if(url.includes('/events'))return []
    return new URL(url).searchParams.get('page') === '1' ? Array.from({length:100},(_,i)=>person(`person-${i}`,i===99?500:1)) : [person('last-page',900)]
  })(env)
  assert.equal(value.contributors[0].name,'last-page')
  assert.equal(value.contributors[0].count,1800)
  assert.equal(value.sources[0].authorCount,101)
  assert(calls.some(url=>url.includes('page=2')))
})

test('目录完整分页并应用排除规则，隔离私有仓库与跨组织错误', async () => {
  const value=await service(async url=>url.includes('/orgs/')
    ? new URL(url).searchParams.get('page') === '1'?Array.from({length:100},(_,i)=>repo(`r${i}`,i+1)):[repo('tail',101),repo('private',102,{private:true})]
    :[] )({...env,DASHBOARD_GITHUB_EXCLUDE_REPOS:'SDUTVINCI/r0'})
  assert.equal(value.organization.discoveredCount,101)
  assert.equal(value.organization.includedCount,100)
  assert.equal(value.sources.some(source=>source.repo.endsWith('/private')),false)
  const invalid=await service(async()=>[repo('bad',1,{full_name:'another/robot'})])(env)
  assert.equal(invalid.organization.unavailable,true)
  assert.equal(invalid.organization.reason,'INVALID_ORGANIZATION_NAMESPACE')
})

test('手动仓库也验证公开性，私有仓库不读取统计', async()=>{
  const calls=[]
  const value=await service(async url=>{calls.push(url);return {full_name:'SDUTVINCI/private',private:true}})({DASHBOARD_GITHUB_REPOS:'SDUTVINCI/private',DASHBOARD_GITHUB_TOKEN:'test-only-token'})
  assert.equal(value.configurationError,true)
  assert.equal(calls.length,1)
})

test('PR/事项/版本动态按 GitHub 类型解释，敏感、未知和未来事件被排除', async()=>{
  const value=await service(async url=>url.includes('/orgs/')?[repo('a')]:url.includes('/contributors')?[]:[
    event('PullRequestEvent',{action:'closed',pull_request:{number:12,merged:true,title:'never-return-payload'}}),
    {...event('IssuesEvent',{action:'opened',issue:{number:3}}),id:'2'},
    {...event('ReleaseEvent',{action:'published'}),id:'3'},
    {...event(),id:'4',public:false},
    {...event(),id:'5',created_at:'2028-01-01T00:00:00Z'},
    {...event('UnknownEvent'),id:'6'}
  ])(env)
  assert.deepEqual(value.events.map(row=>row.action),['合并了代码','打开了事项','发布了版本'])
  assert.equal(value.events[0].href,'https://github.com/SDUTVINCI/a/pull/12')
  assert(!JSON.stringify(value).includes('never-return-payload'))
})

test('贡献与动态独立缓存，限流时回退旧值，最多保留一天',async()=>{
  let time=instant,broken=false,calls=0
  const read=createDashboardGithub({now:()=>time,json:async url=>{calls++;if(broken && url.includes('/contributors'))throw new Error('UPSTREAM_HTTP_403');return upstream(url)}})
  assert.equal((await read(env)).contributors[0].count,5)
  const count=calls
  await read(env);assert.equal(calls,count)
  time+=31*60_000;broken=true
  const stale=await read(env)
  assert.equal(stale.contributors[0].count,5)
  assert.equal(stale.sources[0].contributionsReason,'HTTP_403')
  assert.equal(stale.sources[0].eventsUnavailable,false)
  time+=25*3600_000
  assert.equal((await read(env)).contributors.length,0)
})

test('超时预算中止整轮、并发合并、配置变更隔离缓存',async()=>{
  let calls=0
  const slow=service(async(url,options)=>{calls++;if(url.includes('/orgs/'))return [repo('a')];return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('SYNC_BUDGET_EXCEEDED'))))},{budgetMs:30})
  const [a,b]=await Promise.all([slow(env),slow(env)])
  assert.equal(calls,3)
  assert.equal(a.unavailable,true);assert.deepEqual(a,b)
  const read=service(async url=>{calls++;return upstream(url)})
  await read(env);const before=calls
  await read({...env,DASHBOARD_GITHUB_TOKEN:'different-test-token'})
  assert(calls>before)
})

test('研发接口失败不阻塞飞书任务，未登录不访问 GitHub',async()=>{
  const calls=[]
  const read=createDashboardService({now:()=>instant,fetcher:async url=>{
    calls.push(url)
    if(url.includes('api.github.com'))return new Response('never-return-upstream',{status:429})
    if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'never-return-token'})
    return Response.json({code:0,data:{items:[{record_id:'task',fields:{任务详情:'任务',完成情况:'未完成'}}],has_more:false}})
  }})
  const config={...env,DASHBOARD_ENABLED:'true',FEISHU_APP_ID:'example',FEISHU_APP_SECRET:'secret',FEISHU_BITABLE_APP_TOKEN:'base',FEISHU_BITABLE_TABLE_ID:'table'}
  assert.equal((await read({env:config,request:new Request('https://example.test/api/dashboard')})).status,401)
  assert.equal(calls.length,0)
  const response=await read({env:config,authenticated:true,request:new Request('https://example.test/api/dashboard')})
  const value=await response.json()
  assert.equal(response.status,200);assert.equal(value.tasks.length,1)
  assert.equal(value.development.unavailable,true)
  assert.equal(value.development.organization.reason,'HTTP_429')
  assert(!JSON.stringify(value).includes('never-return'))
})

test('成员按 GitHub 个人主页唯一匹配，链接使用本站稳定 memberKey',()=>{
  const member={name:'成员甲',memberKey:'member-a',image:'/a.webp',links:{github:'https://github.com/Example/'}}
  const value=dashboardCodeProfile({name:'别名',login:'example'},[member],'/logo.webp')
  assert.deepEqual(value,{name:'成员甲',image:'/a.webp',href:'/team/member-a',external:false})
  assert.equal(dashboardCodeProfile({name:'example'},[member,{...member,memberKey:'other'}],'/logo.webp').external,true)
  for(const href of ['https://github.com/org/repo','https://github.com.evil.test/example','https://user:pass@github.com/example','https://github.com/example?token=secret']) assert.equal(githubProfileLogin(href),'')
  assert.equal(dashboardCodeProfile({name:'unknown',href:'javascript:alert(1)'},[], '/logo.webp').href,'https://github.com')
})
