targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment (e.g., dev, prod)')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

param containerAppName string = 'copilot-cli-web'

// Azure AD + GitHub OAuth Device Flow (no client secret needed)
@secure()
param azureClientId string = ''
@secure()
param azureTenantId string = ''
@secure()
param azureClientSecret string = ''
@secure()
param githubClientId string = ''
@secure()
param sessionSecret string = newGuid()

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: '${abbrs.resourceGroup}${environmentName}'
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

module containerApps './modules/container-apps.bicep' = {
  name: 'container-apps'
  scope: rg
  params: {
    name: containerAppName
    location: location
    tags: tags
    containerRegistryName: containerRegistry.outputs.name
    environmentName: '${abbrs.containerAppsEnvironment}${resourceToken}'
    azureClientId: azureClientId
    azureTenantId: azureTenantId
    azureClientSecret: azureClientSecret
    githubClientId: githubClientId
    sessionSecret: sessionSecret
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = containerRegistry.outputs.name
output AZURE_CONTAINER_APP_FQDN string = containerApps.outputs.fqdn
output AZURE_RESOURCE_GROUP string = rg.name
