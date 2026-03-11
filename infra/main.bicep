targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment (e.g., dev, prod)')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

param containerAppName string = 'copilot-unleashed'

@description('Resource group name (defaults to rg-copilot-unleashed)')
param resourceGroupName string = 'rg-copilot-unleashed'

@secure()
@minLength(1)
@description('GitHub OAuth app client ID')
param githubClientId string

@secure()
@description('Session encryption secret')
param sessionSecret string = newGuid()

param containerAppImage string = ''

@description('Minimum replicas (0 for dev, 1+ for prod)')
param minReplicas int = 1

@description('Maximum replicas')
param maxReplicas int = 3

@description('CPU cores per replica (e.g. 0.25, 0.5, 1, 2, 4)')
param cpuCores string = '1'

@description('Memory per replica (e.g. 0.5Gi, 1Gi, 2Gi, 4Gi, 8Gi)')
param memoryGi string = '2Gi'

@description('Comma-separated IP ranges to allow access (CIDR notation, empty = allow all)')
param ipRestrictions string = ''

@description('Comma-separated GitHub usernames allowed to log in (empty = allow all)')
param allowedGithubUsers string = ''

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module containerRegistry './modules/container-registry.bicep' = {
  name: 'container-registry'
  scope: rg
  params: {
    name: '${abbrs.containerRegistry}${resourceToken}'
    location: location
    tags: tags
  }
}

module managedIdentity './modules/managed-identity.bicep' = {
  name: 'managed-identity'
  scope: rg
  params: {
    name: '${abbrs.managedIdentity}${resourceToken}'
    location: location
    tags: tags
    containerRegistryId: containerRegistry.outputs.id
  }
}

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    name: '${abbrs.monitoring}${resourceToken}'
    location: location
    tags: tags
  }
}

module containerApps './modules/container-apps.bicep' = {
  name: 'container-apps'
  scope: rg
  params: {
    name: containerAppName
    location: location
    tags: tags
    containerRegistryLoginServer: containerRegistry.outputs.loginServer
    environmentName: '${abbrs.containerAppsEnvironment}${resourceToken}'
    image: empty(containerAppImage) ? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest' : containerAppImage
    managedIdentityId: managedIdentity.outputs.id
    githubClientId: githubClientId
    sessionSecret: sessionSecret
    allowedGithubUsers: allowedGithubUsers
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    cpuCores: cpuCores
    memoryGi: memoryGi
    ipRestrictions: ipRestrictions
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = containerRegistry.outputs.name
output AZURE_CONTAINER_APP_FQDN string = containerApps.outputs.fqdn
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_MANAGED_IDENTITY_CLIENT_ID string = managedIdentity.outputs.clientId
