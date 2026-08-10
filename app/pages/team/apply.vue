<script setup lang="ts">
useHead({ title: '申请成员信息 · Vinci 机器人队' })
</script>

<template>
  <main>
    <section class="page-hero members-hero"><div><p class="eyebrow">MEMBER APPLICATION</p><h1>申请成员信息</h1><p>无需登录即可填写；提交后由管理员审核，审核通过前不会公开。</p></div></section>
    <section class="member-directory member-application-page"><MemberProfileApplicationForm /></section>
  </main>
</template>
