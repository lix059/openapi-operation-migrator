<template>
  <button @click="load">Load users</button>
</template>

<script setup lang="ts">
import { AdminApi } from '@/api'

function load() {
  return AdminApi.getUserListOld()
}
</script>
