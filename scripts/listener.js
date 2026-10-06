function injectCode() {
  const head = document.head || document.getElementsByTagName("head")[0];
  const gtmScript = document.createElement("script");
  gtmScript.textContent = `
  function dataLayerSender() {
  window.dataLayer = window.dataLayer || [];
  window.parent.postMessage({ event_source: "custom_pixel_dataLayer_replace", data: window.dataLayer }, "*");
  var oldPush = window.dataLayer.push;
  window.dataLayer.push = function () {
    var states = [].slice.call(arguments, 0);
    window.parent.postMessage({ event_source: "customPixel", data: states}, "*");
    return oldPush.apply(window.dataLayer, states);
  };
  };
  const myInterval = setInterval(()=>{
    if(window.dataLayer){
    clearInterval(myInterval);
    dataLayerSender();
    }
    
  },200)
`;
  head.prepend(gtmScript);
}
injectCode();
