export const createHmrStateRuntime = (dependencies) => {
  const {
    globalThisLike,
    stateKey,
  } = dependencies;

  const getOrCreateHmrState = () => {
    if (!globalThisLike[stateKey]) {
      globalThisLike[stateKey] = {
        isShuttingDown: false,
        signalsAttached: false,
      };
    }
    return globalThisLike[stateKey];
  };

  return {
    getOrCreateHmrState,
  };
};
