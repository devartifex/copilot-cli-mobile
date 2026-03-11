@description('Name of the User-Assigned Managed Identity')
param name string

@description('Location for the resource')
param location string

param tags object = {}

@description('Resource ID of the Container Registry to grant AcrPull')
param containerRegistryId string

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

// Grant AcrPull role to the managed identity on the container registry
@description('AcrPull role definition ID')
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistryId, managedIdentity.id, acrPullRoleId)
  scope: containerRegistry
  properties: {
    principalId: managedIdentity.properties.principalId
    roleDefinitionId: acrPullRoleId
    principalType: 'ServicePrincipal'
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: last(split(containerRegistryId, '/'))
}

output id string = managedIdentity.id
output principalId string = managedIdentity.properties.principalId
output clientId string = managedIdentity.properties.clientId
output name string = managedIdentity.name
