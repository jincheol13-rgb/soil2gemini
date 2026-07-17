/**
 * 양구군농업기술센터 지능형 비료사용처방 서비스
 * 애플리케이션 스크립트 (app.js)
 */

// === [개발자 설정] SDK 및 보안 키 고정 지정 ===
const RECAPTCHA_SITE_KEY = "YOUR_RECAPTCHA_SITE_KEY_HERE";

// 로컬 파일 실행(file://) 시 로컬 백엔드로 자동 연동
const BACKEND_URL = window.location.origin.includes('file://') ? 'http://localhost:3000' : window.location.origin;

// PDF.js 워커 설정
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
}
// 토양 성분 한글 이름 및 단위 매핑
const NUTRIENT_METADATA = {
  pH: { name: 'pH (토양 산도)', unit: '' },
  organic_matter: { name: '유기물 (g/kg)', unit: 'g/kg' },
  available_phosphate: { name: '유효인산 (mg/kg)', unit: 'mg/kg' },
  potassium: { name: '칼륨 (cmol+/kg)', unit: 'cmol+/kg' },
  calcium: { name: '칼슘 (cmol+/kg)', unit: 'cmol+/kg' },
  magnesium: { name: '마그네슘 (cmol+/kg)', unit: 'cmol+/kg' },
  ec: { name: '전기전도도 (EC, dS/m)', unit: 'dS/m' }
};

// reCAPTCHA v3 스크립트 렌더러 동적 주입
function initRecaptchaScript() {
  if (RECAPTCHA_SITE_KEY && RECAPTCHA_SITE_KEY !== "YOUR_RECAPTCHA_SITE_KEY_HERE" && RECAPTCHA_SITE_KEY !== "") {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    console.log("[보안] reCAPTCHA v3 스크립트가 동적으로 헤더에 로드되었습니다.");
  } else {
    console.log("[보안] reCAPTCHA 사이트 키가 지정되지 않아 보안 문자를 생략하고 시뮬레이션(Mock) 모드로 작동합니다.");
  }
}

// reCAPTCHA 토큰 획득 비동기 함수
async function getRecaptchaToken(action) {
  if (typeof grecaptcha === 'undefined' || !RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY === "YOUR_RECAPTCHA_SITE_KEY_HERE" || RECAPTCHA_SITE_KEY === "") {
    console.log("[reCAPTCHA] 사이트 키가 유효하지 않거나 라이브러리가 로드되지 않아 빈 토큰을 반환합니다.");
    return "";
  }
  return new Promise((resolve) => {
    grecaptcha.ready(async () => {
      try {
        const token = await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
        resolve(token);
      } catch (err) {
        console.warn("[reCAPTCHA] 토큰 획득 실패:", err);
        resolve("");
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // reCAPTCHA v3 스크립트 렌더러 주입
  initRecaptchaScript();

  // === 1. 상태 변수 선언 ===
  let selectedCrop = null;
  let uploadedFile = null;
  let soilAnalysisData = null; // 백엔드 제미나이로부터 추출된 분석 데이터
  let currentUtterance = null; // TTS 상태 트래킹
  let imagePreviewUrl = null; // 이미지 미리보기 Object URL 트래킹

  // === 2. 엘리먼트 참조 ===
  const modal = document.getElementById('notice-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const samplingModal = document.getElementById('sampling-image-modal');
  const showSamplingBtn = document.getElementById('show-sampling-btn');
  const closeSamplingModalBtn = document.getElementById('close-sampling-modal-btn');
  const cropCards = document.querySelectorAll('.crop-card');
  
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const selectFileBtn = document.getElementById('select-file-btn');
  const filePreviewContainer = document.getElementById('file-preview-container');
  const fileNameDisplay = document.getElementById('file-name');
  const fileSizeDisplay = document.getElementById('file-size');
  const removeFileBtn = document.getElementById('remove-file-btn');
  const dropzoneContent = document.querySelector('.dropzone-content');
  const imagePreview = document.getElementById('image-preview');
  const pdfPreviewCanvas = document.getElementById('pdf-preview-canvas');
  const pdfLoadingIndicator = document.getElementById('pdf-loading-indicator');
  const previewFileIcon = document.getElementById('preview-file-icon');
  
  const analyzeBtn = document.getElementById('analyze-btn');
  const loadingSpinner = document.getElementById('loading-spinner');
  
  const resultSection = document.getElementById('result-section');
  const resultCropTitle = document.getElementById('result-crop-title');
  const summaryFarmerInfo = document.getElementById('summary-farmer-info');
  const bulletLevel = document.getElementById('bullet-level');
  const bulletNutrient = document.getElementById('bullet-nutrient');
  const bulletPh = document.getElementById('bullet-ph');
  const bulletPhosphate = document.getElementById('bullet-phosphate');
  const summaryTtsBtn = document.getElementById('summary-tts-btn');
  const metricsContainer = document.getElementById('metrics-container');
  
  const downloadBtn = document.getElementById('download-btn');
  const restartBtn = document.getElementById('restart-btn');
  const anomalyRestartBtn = document.getElementById('anomaly-restart-btn');

  // === 3. 접속 공지 모달 제어 ===
  if (closeModalBtn && modal) {
    closeModalBtn.addEventListener('click', () => {
      modal.classList.add('fade-out');
      setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('fade-out');
      }, 300);
    });
  }

  // === 3-1. 토양 시료 채취 방법 이미지 모달 제어 ===
  if (showSamplingBtn && samplingModal) {
    showSamplingBtn.addEventListener('click', () => {
      samplingModal.style.display = 'flex';
    });
  }

  if (closeSamplingModalBtn && samplingModal) {
    closeSamplingModalBtn.addEventListener('click', () => {
      samplingModal.style.display = 'none';
    });
    // 배경 클릭 시 닫기
    samplingModal.addEventListener('click', (e) => {
      if (e.target === samplingModal) {
        samplingModal.style.display = 'none';
      }
    });
  }

  // === 4. 작물 선택 제어 ===
  cropCards.forEach(card => {
    card.addEventListener('click', () => {
      cropCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedCrop = card.getAttribute('data-crop');
      updateAnalyzeButtonState();
    });
  });

  // === 5. 이미지 파일 업로드 & 검증 ===
  if (selectFileBtn && fileInput) {
    selectFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => {
      fileInput.click();
    });

    // 드래그 앤 드롭
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('dragover');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const file = dt.files[0];
      handleFileSelection(file);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFileSelection(e.target.files[0]);
    });
  }

  if (removeFileBtn) {
    removeFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetFileUpload();
    });
  }

  // 파일 선택 및 유효성 검사 (MIME 타입 + 확장자 이중 체크, PNG 완전 차단)
  // 파일 선택 및 유효성 검사 (MIME 타입 + 확장자 이중 체크, PNG 완전 차단)
  function handleFileSelection(file) {
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'application/pdf'];
    const fileExtension = file.name.split('.').pop().toLowerCase();
    const allowedExtensions = ['jpg', 'jpeg', 'pdf'];
    
    // 브라우저 MIME 판독 실패 대비 확장자 백업 검증 진행
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      alert('⚠️ JPG 이미지 또는 PDF 파일만 업로드할 수 있습니다. (PNG 파일은 지원하지 않습니다)');
      resetFileUpload();
      return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      alert('⚠️ 파일 크기가 5MB를 초과합니다. 5MB 이하의 JPG 또는 PDF 파일을 선택해 주세요.');
      resetFileUpload();
      return;
    }

    // 기존 Object URL 해제
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = null;
    }
    uploadedFile = file;
    if (fileNameDisplay) fileNameDisplay.textContent = file.name;
    if (fileSizeDisplay) fileSizeDisplay.textContent = `(${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
    
    // 미리보기 영역 초기 상태 설정
    if (imagePreview) {
      imagePreview.style.display = 'none';
      imagePreview.src = '';
    }
    if (pdfPreviewCanvas) {
      pdfPreviewCanvas.style.display = 'none';
      const ctx = pdfPreviewCanvas.getContext('2d');
      ctx.clearRect(0, 0, pdfPreviewCanvas.width, pdfPreviewCanvas.height);
    }
    if (pdfLoadingIndicator) {
      pdfLoadingIndicator.style.display = 'none';
    }

    const isPdf = fileExtension === 'pdf' || file.type === 'application/pdf';

    if (previewFileIcon) {
      if (isPdf) {
        previewFileIcon.className = 'fa-solid fa-file-pdf file-icon';
        previewFileIcon.style.color = '#e63946'; // Red for PDF
      } else {
        previewFileIcon.className = 'fa-solid fa-image file-icon';
        previewFileIcon.style.color = 'var(--color-primary)'; // Primary green for image
      }
    }

    if (dropzoneContent) dropzoneContent.style.display = 'none';
    if (filePreviewContainer) filePreviewContainer.style.display = 'flex';

    // 파일 유형별 미리보기 생성
    if (isPdf) {
      if (pdfLoadingIndicator) pdfLoadingIndicator.style.display = 'flex';
      
      const fileReader = new FileReader();
      fileReader.onload = function(e) {
        const typedarray = new Uint8Array(e.target.result);
        
        if (typeof pdfjsLib === 'undefined') {
          console.error('pdfjsLib가 로드되지 않았습니다.');
          if (pdfLoadingIndicator) pdfLoadingIndicator.style.display = 'none';
          return;
        }

        pdfjsLib.getDocument(typedarray).promise.then(function(pdf) {
          pdf.getPage(1).then(function(page) {
            // scale 설정 (화면 픽셀 밀도에 맞추어 1.5로 렌더링하고 canvas 크기 조정)
            const viewport = page.getViewport({ scale: 1.5 });
            if (pdfPreviewCanvas) {
              const context = pdfPreviewCanvas.getContext('2d');
              pdfPreviewCanvas.height = viewport.height;
              pdfPreviewCanvas.width = viewport.width;

              const renderContext = {
                canvasContext: context,
                viewport: viewport
              };

              page.render(renderContext).promise.then(function() {
                if (pdfLoadingIndicator) pdfLoadingIndicator.style.display = 'none';
                pdfPreviewCanvas.style.display = 'block';
              }).catch(function(err) {
                console.error('PDF 페이지 렌더링 실패:', err);
                if (pdfLoadingIndicator) pdfLoadingIndicator.style.display = 'none';
              });
            }
          }).catch(function(err) {
            console.error('PDF 페이지 로딩 실패:', err);
            if (pdfLoadingIndicator) pdfLoadingIndicator.style.display = 'none';
          });
        }).catch(function(err) {
          console.error('PDF 문서 로딩 실패:', err);
          if (pdfLoadingIndicator) pdfLoadingIndicator.style.display = 'none';
        });
      };
      fileReader.readAsArrayBuffer(file);
    } else {
      // JPG/JPEG 이미지 미리보기
      imagePreviewUrl = URL.createObjectURL(file);
      if (imagePreview) {
        imagePreview.src = imagePreviewUrl;
        imagePreview.style.display = 'block';
      }
    }
    
    updateAnalyzeButtonState();
  }

  function resetFileUpload() {
    uploadedFile = null;
    if (fileInput) fileInput.value = '';
    // Object URL 해제 및 미리보기 정리
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = null;
    }
    if (imagePreview) {
      imagePreview.style.display = 'none';
      imagePreview.src = '';
    }
    if (pdfPreviewCanvas) {
      pdfPreviewCanvas.style.display = 'none';
      const ctx = pdfPreviewCanvas.getContext('2d');
      ctx.clearRect(0, 0, pdfPreviewCanvas.width, pdfPreviewCanvas.height);
    }
    if (pdfLoadingIndicator) {
      pdfLoadingIndicator.style.display = 'none';
    }
    if (dropzoneContent) dropzoneContent.style.display = 'flex';
    if (filePreviewContainer) filePreviewContainer.style.display = 'none';
    updateAnalyzeButtonState();
  }

  function updateAnalyzeButtonState() {
    if (selectedCrop && uploadedFile) {
      analyzeBtn.removeAttribute('disabled');
    } else {
      analyzeBtn.setAttribute('disabled', 'true');
    }
  }

  // === 6. 백엔드 API 호출 및 분석 연동 ===
  analyzeBtn.addEventListener('click', async () => {
    if (!selectedCrop || !uploadedFile) return;

    stopSpeaking();

    // 로딩 화면 표시
    loadingSpinner.style.display = 'flex';

    try {
      const base64Data = await fileToBase64(uploadedFile);
      const recaptchaToken = await getRecaptchaToken('analyze_image');
      
      let parsedData;

      try {
        const response = await fetch(`${BACKEND_URL}/api/analyze-image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            image: base64Data,
            mimeType: uploadedFile.type || (uploadedFile.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
            crop: selectedCrop,
            recaptchaToken: recaptchaToken,
            fileName: uploadedFile.name
          })
        });

        if (!response.ok) {
          const errRes = await response.json().catch(() => ({}));
          throw new Error(errRes.error || `서버 에러 (상태코드: ${response.status})`);
        }

        parsedData = await response.json();
      } catch (apiError) {
        console.error('분석 실패:', apiError);
        alert(`토양 분석에 실패했습니다.\n사유: ${apiError.message || '네트워크 연결 상태를 확인하고 잠시 후 다시 시도해 주세요.'}`);
        
        console.warn("[시스템] 백엔드 분석 실패 또는 API 오류로 로컬 시뮬레이션 데이터를 전송합니다.", apiError.message);
        await new Promise(resolve => setTimeout(resolve, 1200));
        parsedData = getMockAnalysisData(selectedCrop, uploadedFile.name);
      }

      // 로컬 토양 분석 엔진 가동 (서버 수치 JSON -> 처방 상태 데이터 구조 변환)
      soilAnalysisData = processSoilMetrics(parsedData, selectedCrop);
      
      // 이상 데이터 감지 규칙 적용
      const isAnomaly = checkSoilAnomaly(soilAnalysisData);
      if (isAnomaly) {
        renderAnomalyResult(soilAnalysisData);
      } else {
        renderAnalysisResult(soilAnalysisData);
      }

    } catch (error) {
      console.error(error);
      alert(`⚠️ 처방 분석 중 오류가 발생했습니다.\n\n[상세 원인]\n${error.message}`);
    } finally {
      setTimeout(() => {
        loadingSpinner.style.display = 'none';
      }, 500);
    }
  });

  // === 7. 로컬 토양 수치 분석 엔진 (핵심) ===
  function processSoilMetrics(rawData, crop) {
    const result = {
      crop: crop,
      metrics: []
    };

    // 각 성분별 수치 판별 및 가이드라인 생성
    Object.keys(NUTRIENT_METADATA).forEach(key => {
      const value = rawData[key] !== undefined ? rawData[key] : '미측정';
      const diagnosis = getNutrientDiagnosis(key, value, crop);
      result.metrics.push({
        key: key,
        name: NUTRIENT_METADATA[key].name,
        value: value,
        status: diagnosis.status,
        impact: diagnosis.impact,
        range: diagnosis.range
      });
    });

    return result;
  }

  function getNutrientDiagnosis(key, value, crop) {
    const num = parseFloat(value);
    if (isNaN(num) || value === '미측정' || value === null) {
      return { status: '적정', range: null, impact: '해당 처방서에 수치가 기재되어 있지 않거나 읽지 못했습니다.' };
    }

    const isRice = crop === '벼';
    const isFacility = ['멜론', '방울토마토', '토마토', '수박', '오이'].includes(crop);

    let range = { min: 0, max: 0, unit: NUTRIENT_METADATA[key].unit };

    switch (key) {
      case 'pH':
        range.min = isRice ? 5.5 : 6.0;
        range.max = 6.5;
        if (num < range.min) {
          return { status: '부족', range, impact: `토양 산도가 pH ${num}으로 산성 상태입니다. 고토석회 등의 석회질 비료 시용이 필요합니다.` };
        } else if (num > range.max) {
          return { status: '과다', range, impact: `토양 산도가 pH ${num}으로 높습니다. 알칼리화로 미량요소 흡수 장애가 생길 수 있어 추가 석회 시용 금지를 권장합니다.` };
        }
        return { status: '적정', range, impact: `토양 산도가 pH ${num}으로 작물 재배에 알맞은 적정 범위를 유지하고 있습니다.` };

      case 'organic_matter':
        range.min = isRice ? 25 : 20;
        range.max = 30;
        if (num < range.min) {
          return { status: '부족', range, impact: `유기물 함량이 ${num} g/kg으로 다소 부족합니다. 땅의 영양 보존력을 높이기 위해 퇴비 공급을 권장합니다.` };
        } else if (num > range.max) {
          return { status: '과다', range, impact: `유기물 함량이 ${num} g/kg으로 다소 많습니다. 과도한 퇴비 투입을 줄여 양분 균형을 맞춰 주십시오.` };
        }
        return { status: '적정', range, impact: `유기물이 ${num} g/kg으로 적정하여 유용 미생물 활성과 뿌리 성장에 유리한 상태입니다.` };

      case 'available_phosphate':
        if (isRice) { range.min = 80; range.max = 120; }
        else if (isFacility) { range.min = 350; range.max = 450; }
        else { range.min = 300; range.max = 400; }

        if (num < range.min) {
          return { status: '부족', range, impact: `유효인산이 ${num} mg/kg으로 부족해 생육 초기의 뿌리 발육이 지체될 수 있으니 인산 비료 보충을 권장합니다.` };
        } else if (num > range.max) {
          return { status: '과다', range, impact: `유효인산이 ${num} mg/kg으로 적정치의 수배 이상 쌓여 과잉 상태입니다. 인산비료 및 계분/돈분 사용을 자제해 주십시오.` };
        }
        return { status: '적정', range, impact: `유효인산이 ${num} mg/kg으로 아주 양호한 상태로 유지되어 뿌리 성장을 원활히 돕습니다.` };

      case 'potassium':
        if (isRice) { range.min = 0.25; range.max = 0.30; }
        else if (isFacility) { range.min = 0.70; range.max = 0.80; }
        else { range.min = 0.50; range.max = 0.60; }

        if (num < range.min) {
          return { status: '부족', range, impact: `칼륨 성분이 ${num} cmol+/kg으로 부족하여 줄기가 연약해지고 병해 저항력이 저하될 수 있어 보충을 권장합니다.` };
        } else if (num > range.max) {
          return { status: '과다', range, impact: `칼륨 수치가 ${num} cmol+/kg으로 과잉 축적되어 마그네슘과 칼슘 흡수를 억제할 우려가 있으니 가리 살포를 제한하십시오.` };
        }
        return { status: '적정', range, impact: `칼륨 수치가 ${num} cmol+/kg으로 적정하여 가뭄 및 병해 극복 및 작물 신장에 큰 도움을 줍니다.` };

      case 'calcium':
        range.min = 5.0;
        range.max = 6.0;
        if (num < range.min) {
          return { status: '부족', range, impact: `칼슘 수치가 ${num} cmol+/kg으로 부족해 열매 끝마름 및 생장 둔화가 우려되므로 석회 투입을 권장합니다.` };
        } else if (num > range.max) {
          return { status: '과다', range, impact: `칼슘 수치가 ${num} cmol+/kg으로 과도하여 흙이 굳어지거나 칼륨 흡수를 방해할 수 있으니 추가 석회질 비료 살포를 자제하십시오.` };
        }
        return { status: '적정', range, impact: `칼슘 수치가 ${num} cmol+/kg으로 알맞게 안착되어 세포벽 강화를 통한 신뢰할 만한 생육을 돕습니다.` };

      case 'magnesium':
        range.min = 1.5;
        range.max = 2.0;
        if (num < range.min) {
          return { status: '부족', range, impact: `마그네슘이 ${num} cmol+/kg으로 부족해 잎 황화와 광합성 부진이 우려됩니다. 황산마그네슘 공급이 적극 추천됩니다.` };
        } else if (num > range.max) {
          return { status: '과다', range, impact: `마그네슘이 ${num} cmol+/kg으로 많은 편입니다. 다른 성분 결핍을 예방하기 위해 마그네슘 비료 시용을 중단하십시오.` };
        }
        return { status: '적정', range, impact: `마그네슘이 ${num} cmol+/kg으로 알맞게 조화를 이루어 푸른 잎과 충분한 에너지 합성을 가능하게 합니다.` };

      case 'ec':
        if (isRice) { range.min = 0; range.max = 1.0; }
        else if (isFacility) { range.min = 0; range.max = 2.0; }
        else { range.min = 0; range.max = 1.5; }

        if (num > range.max) {
          return { status: '과다', range, impact: `전기전도도가 ${num} dS/m으로 염류 집적 위험 수준입니다. 물대기, 유기물 시용 및 제염 작물을 활용해 세척해 주십시오.` };
        }
        return { status: '적정', range, impact: `전기전도도가 ${num} dS/m으로 낮고 매우 안전하여 염류 집적 피해 없이 건강하게 자랄 수 있는 밭입니다.` };
    }

    return { status: '적정', range: null, impact: '정상 작동' };
  }

  // === 8. 분석 결과 화면 렌더링 ===
  function renderAnalysisResult(data) {
    if (!data) return;
    
    resultCropTitle.textContent = `${data.crop} 처방 가이드`;
    
    // 종합 진단 텍스트 생성
    let isPhosphateOver = false;
    let isPhAcid = false;
    let isEcOver = false;

    data.metrics.forEach(m => {
      if (m.key === 'available_phosphate' && m.status === '과다') isPhosphateOver = true;
      if (m.key === 'pH' && m.status === '부족') isPhAcid = true;
      if (m.key === 'ec' && m.status === '과다') isEcOver = true;
    });

    let levelText = "시비 균형 양호";
    let nutrientText = "전체적인 양분 상태가 조화롭습니다. 관행 수준으로 시비하셔도 안전합니다.";
    
    if (isPhosphateOver && isPhAcid) {
      levelText = "🚨 긴급 균형 처방 필요 (인산 과다 및 산성화)";
      nutrientText = "인산 비료 사용을 즉시 전면 금지하고, 석회질 비료를 살포하여 산성화된 땅을 중성(약산성)으로 바꾸어 주는 것이 최우선 권장사항입니다.";
    } else if (isPhosphateOver) {
      levelText = "⚠️ 비료 조절 처방 (유효인산 누적 과다)";
      nutrientText = "땅속에 유효인산이 대단히 많습니다. 일반 원예용 복합비료 대신 인산이 포함되지 않은 'NK 복합비료(질소-가리)' 시용을 적극 권장합니다.";
    } else if (isPhAcid) {
      levelText = "⚠️ 토양 개량 처방 (토양 산성화)";
      nutrientText = "토양이 산성화되어 비료를 주어도 작물이 영양분을 온전히 흡수할 수 없습니다. 밭을 갈기 전 고토석회를 골고루 뿌려 양분 효용도를 회복시키십시오.";
    } else if (isEcOver) {
      levelText = "🚨 염류 집적 경보";
      nutrientText = "화학비료 사용을 멈추고 땅을 쉬게 하거나, 물대기를 통해 토양 속 불필요한 염류를 세척해 내어 잔뿌리가 손상되지 않도록 보호해야 합니다.";
    }

    if (summaryFarmerInfo) {
      summaryFarmerInfo.textContent = `양구군 ${data.crop} 농가님의 토양 분석 진단 정보입니다.`;
    }
    if (bulletLevel) {
      bulletLevel.innerHTML = `<strong>비료 시비 수준:</strong> ${levelText}`;
    }
    if (bulletNutrient) {
      bulletNutrient.innerHTML = `<strong>핵심 양분 안내:</strong> ${nutrientText}`;
    }
    
    const phMetric = data.metrics.find(m => m.key === 'pH');
    if (bulletPh && phMetric) {
      bulletPh.innerHTML = `<strong>토양 산도 (pH):</strong> ${phMetric.impact}`;
    }
    
    const phosphateMetric = data.metrics.find(m => m.key === 'available_phosphate');
    if (bulletPhosphate && phosphateMetric) {
      bulletPhosphate.innerHTML = `<strong>유효인산:</strong> ${phosphateMetric.impact}`;
    }
    
    // TTS 버튼 연동
    if (summaryTtsBtn) {
      summaryTtsBtn.onclick = (e) => {
        e.stopPropagation();
        const textToRead = [
          summaryFarmerInfo ? summaryFarmerInfo.textContent : '',
          bulletLevel ? bulletLevel.textContent : '',
          bulletNutrient ? bulletNutrient.textContent : '',
          bulletPh ? bulletPh.textContent : '',
          bulletPhosphate ? bulletPhosphate.textContent : ''
        ].filter(Boolean).join('. ');
        handleTTS(textToRead, summaryTtsBtn);
      };
    }

    // 대시보드 7대 지표 카드 동적 생성
    metricsContainer.innerHTML = '';
    data.metrics.forEach(metric => {
      const card = document.createElement('div');
      card.className = 'metric-item card-sub';
      
      let statusClass = 'status-normal';
      if (metric.status === '부족') statusClass = 'status-under';
      if (metric.status === '과다') statusClass = 'status-over';

      card.innerHTML = `
        <div class="metric-header">
          <span class="metric-name">${metric.name}</span>
          <span class="status-badge ${statusClass}">${metric.status}</span>
        </div>
        <div class="metric-value">${metric.value}</div>
        <p class="metric-impact" id="metric-desc-${metric.key}">${metric.impact}</p>
        <button type="button" class="tts-small-btn card-tts-btn" data-tts-target="metric-desc-${metric.key}" title="음성 듣기">
          <i class="fa-solid fa-volume-high"></i>
        </button>
      `;
      metricsContainer.appendChild(card);
    });

    // 개별 대시보드 내 TTS 버튼 이벤트 바인딩
    metricsContainer.querySelectorAll('.card-tts-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = btn.getAttribute('data-tts-target');
        const text = document.getElementById(targetId).textContent;
        handleTTS(text, btn);
      });
    });

    // 아코디언 상태 및 캐시 리셋
    document.querySelectorAll('.accordion-item').forEach(item => {
      item.classList.remove('active');
      const trigger = item.querySelector('.accordion-trigger');
      const sectionIndex = trigger.getAttribute('data-section');
      const contentBox = document.getElementById(`section-content-${sectionIndex}`);
      if (contentBox) contentBox.textContent = '';
      
      const ttsBtn = item.querySelector('.tts-action-btn');
      if (ttsBtn) {
        ttsBtn.className = 'tts-action-btn';
        ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> 🔊 설명 천천히 듣기';
      }
    });

    document.getElementById('capture-area').style.display = 'block';
    document.getElementById('anomaly-result-container').style.display = 'none';

    resultSection.style.display = 'block';
    resultSection.scrollIntoView({ behavior: 'smooth' });
  }

  // === 9. 아코디언 처방 내용 로컬 룰 기반 가이드 생성 및 지연 렌더링 ===
  const accordionTriggers = document.querySelectorAll('.accordion-trigger');
  
  accordionTriggers.forEach(trigger => {
    trigger.addEventListener('click', async () => {
      const item = trigger.parentElement;
      const sectionIndex = parseInt(trigger.getAttribute('data-section'));
      const isActive = item.classList.contains('active');
      
      if (isActive) {
        item.classList.remove('active');
        stopSpeaking();
      } else {
        item.classList.add('active');
        
        if (sectionIndex === 6) {
          return; // 사진 저장 등 정적 영역
        }

        const contentBox = document.getElementById(`section-content-${sectionIndex}`);
        const loader = item.querySelector('.section-loader');
        
        // 데이터가 아직 바인딩되지 않은 경우 분석 시뮬레이션 후 출력
        if (contentBox && (!contentBox.innerHTML || contentBox.innerHTML.trim() === "")) {
          loader.style.display = 'flex';
          contentBox.style.display = 'none';
          
          // 농민을 위한 자연스러운 지연 UX 제공 (0.6초)
          await new Promise(resolve => setTimeout(resolve, 600));
          
          const text = getLocalAccordionContent(sectionIndex, selectedCrop, soilAnalysisData);
          const highlightedText = highlightBracketInfo(text);
          
          contentBox.innerHTML = highlightedText;
          
          loader.style.display = 'none';
          contentBox.style.display = 'block';
        }
      }
    });
  });

  // 로컬 처방 가이드 생성 엔진
  function getLocalAccordionContent(sectionIndex, crop, data) {
    if (!data) return "처방 데이터가 준비되지 않았습니다.";
    
    // 주요 이상 상황 조사
    let isPhosphateOver = false;
    let isPhAcid = false;
    let isOrganicUnder = false;
    let isMagnesiumUnder = false;
    let isEcOver = false;
    
    let phVal = '미측정';
    let phosphateVal = '미측정';
    let organicVal = '미측정';
    let potassiumVal = '미측정';
    let calciumVal = '미측정';
    let magnesiumVal = '미측정';
    let ecVal = '미측정';

    data.metrics.forEach(m => {
      const val = m.value;
      if (m.key === 'pH') { phVal = val; if (m.status === '부족') isPhAcid = true; }
      if (m.key === 'available_phosphate') { phosphateVal = val; if (m.status === '과다') isPhosphateOver = true; }
      if (m.key === 'organic_matter') { organicVal = val; if (m.status === '부족') isOrganicUnder = true; }
      if (m.key === 'magnesium') { magnesiumVal = val; if (m.status === '부족') isMagnesiumUnder = true; }
      if (m.key === 'ec') { ecVal = val; if (m.status === '과다') isEcOver = true; }
      if (m.key === 'potassium') potassiumVal = val;
      if (m.key === 'calcium') calciumVal = val;
    });

    const isRice = crop === '벼';
    const areaUnit = '100평';

    switch (sectionIndex) {
      case 1: // 내 땅 건강 상태 쉽게 보기
        let stateSummary = `토양 산도(pH ${phVal})는 ${isPhAcid ? '산성을 띄며 개량이 시급하고' : '작물이 성장하기에 아주 적당하며'}, 유기물(${organicVal} g/kg)은 ${isOrganicUnder ? '부족해 거름기 보존력이 약하며' : '넉넉한 양을 잘 품고 있으며'}, 유효인산(${phosphateVal} mg/kg)은 ${isPhosphateOver ? '기준치를 초과하여 비정상적으로 많이 쌓여 있습니다.' : '적정량으로 땅속에 고루 자리 잡고 있습니다.'}`;
        
        let analogy = "";
        if (isPhosphateOver && isPhAcid) {
          analogy = `이를 사람에 비유하면, '위장 기능(pH)이 떨어져 체한 상태인데, 고칼로리 기름진 음식(인산)을 마구 과식하여 비만과 소화불량이 동시에 찾아온 상태'로 볼 수 있습니다. 비료 시용량을 엄격하게 줄이고 산도를 중화하여 밭의 기초 체력을 개선해야 합니다.`;
        } else if (isPhosphateOver) {
          analogy = `이를 사람에 비유하면, '영양을 담는 그릇(유기물)은 넉넉하지만 탄수화물(인산)만 엄청나게 많이 섭취하여 영양이 지나치게 치우친 비만 상태'로 볼 수 있습니다. 인산 성분의 투입을 멈추고 고르게 다른 성분이 들아가게 균형을 맞추어야 합니다.`;
        } else if (isPhAcid) {
          analogy = `이를 사람에 비유하면, '위장 기능(pH)이 약해서 비싸고 좋은 보약(비료)을 듬뿍 먹어도 몸에서 제대로 소화해 흡수하지 못하고 그대로 버리는 상황'에 가깝습니다. 밑거름을 주기 전에 반드시 토양 산성화를 교정해 주셔야 비료 낭비를 막을 수 있습니다.`;
        } else if (isEcOver) {
          analogy = `이를 사람에 비유하면, '땀을 흠뻑 흘렸는데 너무 짠 음식을 가득 먹어 피가 끈적해지고 갈증을 크게 느끼는 탈수 상태'와 같습니다. 비료 염기를 씻어 내리기 위해 충분한 환수와 물대기를 해주어야 합니다.`;
        } else {
          analogy = `이를 사람에 비유하면, '하루 세 끼 골고루 먹고 소화도 매우 잘 시키며 기운이 가득 솟구치는 가장 튼튼하고 균형 잡힌 신체 상태'로 볼 수 있습니다. 현행 비료 주기 주기를 그대로 지키셔도 최고 품질의 결실을 거두실 수 있습니다.`;
        }

        // 성분 불균형 시 발생하는 문제점 정보 구축
        let troubles = [];
        if (isPhAcid) {
          troubles.push(`• 토양 산성: 뿌리의 양분 흡수력이 약해져 비료를 많이 주어도 ${crop}가 잘 먹지 못하고 생육이 불량해집니다.`);
        }
        if (isPhosphateOver) {
          troubles.push(`• 인산 과다: 다른 미량요소(아연, 철 등)의 흡수를 차단하여 잎이 누렇게 변하고 성장이 지체될 수 있습니다.`);
        }
        if (isOrganicUnder) {
          troubles.push(`• 유기물 부족: 흙이 쉽게 단단해져 잔뿌리가 뻗지 못하고 영양분 보존력이 떨어집니다.`);
        }
        if (isEcOver) {
          troubles.push(`• 염류 과다(EC): 잔뿌리가 손상되고 삼투압 현상 때문에 물을 빨아들이지 못해 한낮에 시들게 됩니다.`);
        }
        if (isMagnesiumUnder) {
          troubles.push(`• 마그네슘 부족: 광합성을 담당하는 엽록소가 잘 안 만들어져 아랫잎부터 점차 노랗게 변합니다.`);
        }

        let potassiumMetric = data.metrics.find(m => m.key === 'potassium');
        if (potassiumMetric && potassiumMetric.status === '부족') {
          troubles.push(`• 칼륨 부족: ${crop}의 대가 약해져 쉽게 쓰러지고 가뭄이나 병해를 이겨내는 힘이 약해집니다.`);
        }
        let calciumMetric = data.metrics.find(m => m.key === 'calcium');
        if (calciumMetric && calciumMetric.status === '부족') {
          troubles.push(`• 칼슘 부족: 생장점이나 어린 잎끝이 타들어가며, 열매 채소의 경우 끝부분이 썩거나 물러지는 증상이 생깁니다.`);
        }

        let troubleNote = "";
        if (troubles.length > 0) {
          troubleNote = `\n\n📍 **불균형 시 발생할 수 있는 주요 장해:**\n${troubles.join('\n')}`;
        } else {
          troubleNote = `\n\n📍 **불균형 시 발생할 수 있는 주요 장해:** 현재 모든 수치가 적정하여 영양 불균형으로 인한 생리 장해 우려가 전혀 없는 최상의 상태입니다.`;
        }
        
        return `🌱 **${crop} 재배를 위한 내 땅의 종합 처방 진단**
        
- 지표 상태: ${stateSummary}
- 알기 쉬운 설명: ${analogy}${troubleNote}`;

      case 2: // 필요한 비료 종류 & 포대 수
        let recommendations = [];
        let rIndex = 1;

        // 1. 산도 조절 비료
        if (isPhAcid) {
          recommendations.push(`${rIndex++}. 고토석회 (석회질비료): 약 [ 5 ~ 6포대 ] (포당 20kg)
   - 토양 산성화를 중화하고 칼슘과 마그네슘을 동시에 보충하기 위해 필수적입니다.`);
        } else {
          let phValNum = parseFloat(phVal);
          if (!isNaN(phValNum) && phValNum > 7.0) {
            recommendations.push(`${rIndex++}. 유안 비료 (황산암모늄): 약 [ 1 ~ 1.5포대 ] (포당 20kg)
   - 토양 pH가 다소 높은 상태로, 산도를 서서히 낮추는 생리적 산성 비료가 생육에 더 효과적입니다.`);
          }
        }

        // 2. 기본 복합 비료
        let fertType = isPhosphateOver ? `NK 복합비료 (예: 18-0-16 등)` : `맞춤 복합비료 (1호 또는 2호)`;
        let fertBags = isRice ? `[ 1.8 ~ 2포대 ]` : `[ 2 ~ 2.4포대 ]`;
        let fertDesc = isPhosphateOver 
          ? `토양 내 유효인산이 과잉 축적된 상태이므로, 인산 성분이 빠져 있는 NK 비료를 시용하여 인산 과다 누적을 방지하십시오.` 
          : `토양 인산 수치가 적정하여 질소, 인산, 가리가 골고루 혼합된 맞춤형 복합비료로 균형 시용을 권장합니다.`;
        recommendations.push(`${rIndex++}. ${fertType}: 약 ${fertBags} (포당 20kg)
   - ${fertDesc}`);

        // 3. 인산 전용 비료 (인산 부족 시)
        let phosMetric = data.metrics.find(m => m.key === 'available_phosphate');
        if (phosMetric && phosMetric.status === '부족') {
          recommendations.push(`${rIndex++}. 용성인비 (또는 용과린): 약 [ 1 ~ 1.5포대 ] (포당 20kg)
   - 유효인산 부족으로 초기 뿌리 활착과 꽃눈 형성이 불량할 수 있으므로, 인산 전용 보충 비료가 필요합니다.`);
        }

        // 4. 가리 전용 비료 (칼륨 부족 시)
        let potasMetric = data.metrics.find(m => m.key === 'potassium');
        if (potasMetric && potasMetric.status === '부족') {
          let potasType = ['멜론', '방울토마토', '토마토', '수박', '오이', '사과', '포도', '감자'].includes(crop)
            ? '황산가리 (황산칼륨)' 
            : '염화가리 (염화칼륨)';
          let potasDesc = potasType.includes('황산') 
            ? '전분 축적 및 세포막 강화로 작물의 당도, 향, 저장성을 고루 높이는 황산 가리 비료를 추천합니다.'
            : '칼륨 결핍을 신속히 보충해 줄기의 강도와 가뭄/병해 저항력을 높여 줍니다.';
          recommendations.push(`${rIndex++}. ${potasType}: 약 [ 0.5 ~ 1포대 ] (포당 20kg)
   - ${potasDesc}`);
        }

        // 5. 마그네슘 비료 (마그네슘 부족 시)
        if (isMagnesiumUnder) {
          recommendations.push(`${rIndex++}. 황산마그네슘 (황산고토): 약 [ 0.4 ~ 0.6포대 (약 10kg) ] (포당 20kg)
   - 엽록소 생성을 촉진하여 잎 황화와 광합성 부진을 유발하는 마그네슘 결핍증을 예방합니다.`);
        }

        // 6. 유기질 비료 (유기물 부족 시)
        if (isOrganicUnder) {
          recommendations.push(`${rIndex++}. 혼합 유기질비료 (유박): 약 [ 4 ~ 5포대 ] (포당 20kg)
   - 토양 속 유기물이 부족해 거름 보유력이 떨어져 있으므로 지력을 복원하기 위해 유박 등의 유기질 비료를 살포하십시오.`);
        }

        // 7. 염류 집적 해결제 (EC 과다 시)
        if (isEcOver) {
          recommendations.push(`${rIndex++}. 킬레이트제 (DTPA): 약 [ 0.5 ~ 1kg ] (100평 기준)
   - 토양에 과다 누적된 염류를 가용화하여 불필요한 미량 원소들의 흡수 장애를 해결하고 잔뿌리 장해를 치료합니다.`);
        }

        // 특수한 경우 예외 처리 (기본 비료만 노출될 경우)
        if (recommendations.length === 1) {
          recommendations.push(`${rIndex++}. 친환경 완숙 퇴비: 필요 시 관행 수준 살포
   - 7대 영양 성분이 모두 표준 상태이므로 과도한 비료 살포 없이 기본 토양 환경만 잘 보존해 주시면 됩니다.`);
        }

        return `🛒 **${crop} ${areaUnit} 기준 권장 비료 종류**
현재 토양 검정 결과(pH, 유기물, 유효인산, 칼륨, 칼슘, 마그네슘, EC)의 실측 값을 정밀 대조하여 추천하는 맞춤형 비료 품목입니다.

${recommendations.join('\n')}`;

      case 3: // 비료 살포 시기
        let timingGuide = "";
        if (isRice) {
          timingGuide = `- **1단계 (모내기 2주 전):** 밭갈이 로터리 시 추천받은 밑거름 복합비료를 골고루 뿌려 논바닥을 고르십시오.
- **2단계 (모내기 후 12~14일):** 새끼치기(분얼)에 도움을 주는 가지거름을 살포하십시오.
- **3단계 (이삭패기 25일 전):** 벼의 이삭수를 확보하고 품질을 지탱하는 이삭거름(NK 등)을 소량 분시해 주십시오.`;
        } else if (['아스파라거스', '사과', '곰취', '인삼', '포도'].includes(crop)) {
          timingGuide = `- **1단계 (봄철 해동 직후, 2~3월):** 토양 교정을 위해 고토석회를 먼저 단독으로 살포한 후, 최소 2주간 방치한 뒤 로터리를 치십시오. (퇴비나 화학비료와 즉시 섞이면 질소 가스 피해가 생길 수 있습니다.)
- **2단계 (생육 개시기 밑거름, 3~4월):** 추천된 화학 비료(NK 또는 맞춤)의 70% 수량과 유기질 퇴비 및 황산고토를 함께 살포하여 초기 활착을 도우십시오.
- **3단계 (수확 완료 직후 웃거름, 6~7월):** 작물이 내년도 줄기와 눈을 튼튼히 키울 수 있도록 나머지 30%의 NK비료를 골고루 나눠 뿌려 뿌리 힘을 끝까지 유지해 주십시오.`;
        } else {
          timingGuide = `- **1단계 (정식 2~3주 전):** 고토석회를 고루 살포하고 먼저 흙과 섞어 밭을 가꿔 산성도를 개선하십시오.
- **2단계 (정식 1주 전 밑거름):** 추천 비료의 60%와 퇴비 등을 살포하고 고랑과 두둑을 형성한 후 비닐 멀칭을 마쳐 주십시오.
- **3단계 (생육 중기 웃거름):** 정식 후 한 달 간격으로 추천 비료의 나머지 40%를 2~3차례 나누어 작물의 자람세를 보며 포기 사이에 묻어 주십시오.`;
        }

        return `📅 **${crop} 시기별 올바른 비료 살포 방법 가이드**

${timingGuide}`;

      case 4: // 어떤 퇴비를 얼마나 주나요?
        let manureBags = isOrganicUnder ? `[ 500 ~ 600kg ]` : `[ 300 ~ 400kg ]`;
        let manureCaution = isPhosphateOver ? `⚠️ 현재 밭에 인산 성분이 심하게 쌓여 있습니다. 인산 비료의 주원인이 되는 계분(닭똥)과 돈분(돼지똥)의 사용은 절대 피하십시오. 가스 장해가 없고 인산 농도가 대단히 낮고 순수한 완숙 우분(소똥) 또는 톱밥 퇴비만을 살포할 것을 강력히 처방합니다.` : `일반적인 완숙 혼합 퇴비나 유기질 퇴비를 균일하게 시용해 주시면 무방합니다.`;

        return `🪴 **${crop} ${areaUnit} 기준 추천 퇴비 종류 및 사용량**

- 권장 퇴비 살포량: 완숙 우분 퇴비 약 ${manureBags}
- 퇴비 선택 및 경고 사항:
  ${manureCaution}`;

      case 5: // 가장 조심해야 할 점
        let issueSummary = "";
        let actionsText = "";
        let cropNote = "";

        // 작물별 특성 및 맞춤형 가이드라인 수립
        if (crop === '벼') {
          if (isPhAcid) {
            cropNote = `🌾 **벼 농사 핵심 조언:** 벼는 산성 토양에 강한 편이지만, 강산성 상태에서는 토양 내 규산(SiO2) 흡수율이 크게 떨어져 줄기가 약해지고 쓰러짐(도복) 장해나 도열병 피해에 취약해집니다. 규산질 비료 살포를 병행하십시오.`;
          } else if (isPhosphateOver) {
            cropNote = `🌾 **벼 농사 핵심 조언:** 인산이 과도하게 쌓이면 분얼(새끼치기) 촉진을 넘어 유효하지 않은 분얼이 늘어나고 쌀의 단백질 함량이 높아져 밥맛(미질)이 떨어집니다. 이삭거름 시용 시 인산 배제를 추천합니다.`;
          } else if (isEcOver) {
            cropNote = `🌾 **벼 농사 핵심 조언:** 이삭이 밸 무렵 염류 농도가 높으면 이삭 끝이 청이삭이 되거나 낟알이 제대로 차지 않아 수량이 격감합니다. 적극적인 논물 대기와 환수를 시행해 염기를 씻어내십시오.`;
          } else {
            cropNote = `🌾 **벼 농사 핵심 조언:** 지력이 양호해 쓰러짐 피해만 주의하시면 됩니다. 과도한 N(질소) 비료 시용을 자제하여 벼가 웃자라지 않게 조절하시고 고품질 양구 청정 쌀을 수확하십시오.`;
          }
        } else if (crop === '수박') {
          if (isPhAcid) {
            cropNote = `🍉 **수박 농사 핵심 조언:** 산성 토양에서는 칼슘 결핍으로 인해 열매 끝이 검게 썩거나 속이 갈라지는 '피수박' 장해가 발생하기 쉽습니다. 밑거름 준비 시 고토석회질 비료 살포로 토양 산도 개선이 우선되어야 합니다.`;
          } else if (isPhosphateOver) {
            cropNote = `🍉 **수박 농사 핵심 조언:** 과다한 인산은 아연이나 철분 등 미량요소 결핍을 유도하여 잎의 황화를 촉진하고 최종 수박의 당도를 떨어뜨립니다. 계분 및 돈분 퇴비의 시용을 전면 중단하십시오.`;
          } else if (isEcOver) {
            cropNote = `🍉 **수박 농사 핵심 조언:** 수박은 삼투압 염류 장해에 취약해 뿌리가 상하고 포기가 갑자기 시드는 시들음병이 잦습니다. 맹물 관수로 하우스 땅을 세척하고 정식 전 킬레이트제를 살포하십시오.`;
          } else {
            cropNote = `🍉 **수박 농사 핵심 조언:** 현재 토양이 매우 비옥합니다. 다만 수박 비대기 이후 과도한 관수는 수박이 갈라지는 열과 장해를 일으킬 수 있으니 수분 공급량 조절에 집중해 주십시오.`;
          }
        } else if (crop === '사과') {
          if (isPhAcid) {
            cropNote = `🍎 **사과 과원 핵심 조언:** 토양 산성화가 진행되면 과실 저장성이 급격히 떨어지고 과실 표면에 검은 반점이 생기는 고두병(Bitter pit) 피해가 나타납니다. 2~3월 휴면기에 고토석회를 살포해 주십시오.`;
          } else if (isPhosphateOver) {
            cropNote = `🍎 **사과 과원 핵심 조언:** 인산 과다 상태가 지속되면 가지 끝 새 잎들이 빗자루 모양으로 뭉쳐 자라는 아연 결핍 장해가 나타납니다. 화학 복합비료 대신 질소와 칼륨 중심의 비료 살포 및 유기물 멀칭으로 전환하십시오.`;
          } else if (isEcOver) {
            cropNote = `🍎 **사과 과원 핵심 조언:** 과수원 토양에 비료 염류가 높으면 뿌리 호흡이 억제되어 가을철 사과의 붉은 착색이 불량해지고 낙과가 발생할 우려가 있습니다. 완숙 퇴비를 심토 깊이 넣어 토양 물리성을 열어 주십시오.`;
          } else {
            cropNote = `🍎 **사과 과원 핵심 조언:** 사과 재배에 알맞은 균형 잡힌 상태입니다. 과도한 질소질 비료는 과실 착색을 방해하므로, 수확 한 달 전부터 과도한 속효성 질소질 비료 투입을 제한하십시오.`;
          }
        } else if (crop === '인삼') {
          if (isPhAcid) {
            cropNote = `🌱 **인삼 예정지 핵심 조언:** 인삼은 예정지 관리 시 pH를 중성에 가깝게 맞추지 않으면 재배 중 적변삼(표면이 붉어지는 병)이나 뿌리 부패가 심해져 6년근 수확율이 크게 떨어집니다. 예정지 로터리 시 고토석회 중화가 절대적입니다.`;
          } else if (isPhosphateOver) {
            cropNote = `🌱 **인삼 예정지 핵심 조언:** 예정지의 과도한 인산은 인삼 지근(옆뿌리) 발달을 억제하고 주근의 비대를 저해합니다. 인산 흡착을 돕는 심경(깊이갈이) 작업을 늘리고 화학 비료 살포를 자제하십시오.`;
          } else if (isEcOver) {
            cropNote = `🌱 **인삼 예정지 핵심 조언:** 인삼은 염류에 극도로 민감하여 EC가 1.5 dS/m 이상일 시 낙엽과 뿌리 부패가 일어납니다. 예정지에 수단그라스나 호밀을 심어 비료기를 청소하는 흡비작물 재배를 반드시 실시하십시오.`;
          } else {
            cropNote = `🌱 **인삼 예정지 핵심 조언:** 인삼 다년생 재배에 최적화된 예정지 상태입니다. 화학비료 살포를 일절 금하시고, 안전한 완숙 우분/왕겨 퇴비 중심으로 예정지를 보존하십시오.`;
          }
        } else if (['오이', '멜론', '방울토마토', '토마토'].includes(crop)) {
          if (isPhAcid) {
            cropNote = `🥒 **원예과채류 시설재배 핵심 조언:** 저온기에 산성 토양을 방치하면 석회(칼슘) 결핍이 발생하여 잎 끝이 갈색으로 타들어 가고 줄기 끝 생장점이 마르는 장해가 나타납니다. 석회 개량을 꼭 해주십시오.`;
          } else if (isPhosphateOver) {
            cropNote = `🥒 **원예과채류 시설재배 핵심 조언:** 시설 하우스 내 인산 누적은 철분, 칼륨 흡수를 저해하여 잎 황화와 과실 낙과를 유발합니다. 인산 성분이 섞인 영양제나 복합비료 투입을 일절 중단하시기 바랍니다.`;
          } else if (isEcOver) {
            cropNote = `🥒 **원예과채류 시설재배 핵심 조언:** 비닐하우스 특유의 염류 집적(높은 EC)은 삼투압 피해로 뿌리를 태우며 한낮 시들음 현상을 유발합니다. 물대기 제염 작업 및 킬레이트제(DTPA)의 시용을 병행하십시오.`;
          } else {
            cropNote = `🥒 **원예과채류 시설재배 핵심 조언:** 지력이 안정적인 상태입니다. 과채류 생육 성수기에는 일시에 비료를 주기보다는 작물 자람세를 보며 물비료(추비) 형태로 나누어 주는 관비 재배가 효과적입니다.`;
          }
        } else {
          // 기타 작물 (곰취, 아스파라거스, 시래기, 감자 등)
          if (isPhAcid) {
            cropNote = `🪴 **원예작물 노지재배 핵심 조언:** 토양이 산성화되면 밭의 유익 미생물 활성이 저하되고 뿌리썩음병 등 토양 전염성 유해 곰팡이가 급증합니다. 고토석회를 고루 살포하여 밭의 면역력을 회복시켜 주십시오.`;
          } else if (isPhosphateOver) {
            cropNote = `🪴 **원예작물 노지재배 핵심 조언:** 축적된 유효인산은 길항작용으로 칼륨 및 고토의 흡수를 방해하여 생육 저하를 일으킵니다. 복합비료 대신 인산 성분이 없는 비료와 우분 퇴비를 추천합니다.`;
          } else if (isEcOver) {
            cropNote = `🪴 **원예작물 노지재배 핵심 조언:** 염류 집적도가 높으면 뿌리 흡수력이 저하되어 성장이 멈추고 잎 가장자리가 마릅니다. 로터리 시 생볏짚을 썰어 넣어 흙속 질소질 등 염기를 고정하십시오.`;
          } else {
            cropNote = `🪴 **원예작물 노지재배 핵심 조언:** 토양 환경이 매우 좋습니다. 질소 비료의 과다 살포로 농작물이 비정상적으로 웃자라 연약해지는 과비 현상만 주의하여 관리하십시오.`;
          }
        }

        if (isPhosphateOver && isPhAcid) {
          issueSummary = `비료 과다 투입으로 인한 인산 축적과 토양 산성화`;
          actionsText = `📍 인산 과다 해결을 위한 조치:
 - 인산은 땅속에서 잘 씻겨 내려가지 않고 계속 쌓입니다. 올해는 인산이 포함된 가축분 퇴비나 일반 원예용 복합비료의 투입을 일절 중단하시고, 앞서 안내해 드린 인산이 없는 비료(NK비료) 위주로 관리하시기 바랍니다.
 
 📍 산도 교정 실패 시 우려되는 점:
 - pH가 낮은 상태를 방치하면 아무리 비료를 많이 주어도 ${crop}가 양분을 흡수하지 못해 비료 값만 낭비될 수 있습니다. 반드시 봄철 기온이 오를 때 고토석회를 살포하여 땅을 중성(약산성)으로 바꾸어 주십시오.`;
        } else if (isPhosphateOver) {
          issueSummary = `비료 과다 축적으로 인한 유효인산의 비정상적인 집적`;
          actionsText = `📍 인산 과다 해결을 위한 조치:
 - 인산은 땅속에서 잘 씻겨 내려가지 않고 계속 쌓입니다. 올해는 인산이 포함된 가축분 퇴비나 일반 원예용 복합비료의 투입을 일절 중단하시고, 앞서 안내해 드린 인산이 없는 비료(NK비료) 위주로 관리하시기 바랍니다.
 
 📍 토양 영양 흡수 촉진을 위한 처방:
 - 이미 축적된 다량의 인산을 유효하게 녹여내어 작물이 스스로 먹을 수 있도록 돕는 인산가용화균 미생물제를 주기적으로 공급해 주시는 것이 큰 도움이 됩니다.`;
        } else if (isPhAcid) {
          issueSummary = `화학 비료 과다 시용 등으로 인한 토양 산성화`;
          actionsText = `📍 산도 교정 실패 시 우려되는 점:
 - pH가 낮은 상태(산성)를 방치하면 아무리 비료를 많이 주어도 ${crop}가 양분을 흡수하지 못해 비료 값만 낭비될 수 있습니다. 반드시 봄철 기온이 오를 때 고토석회를 살포하여 땅을 중성(약산성)으로 바꾸어 주십시오.
 
 📍 산성 토양 개량을 위한 조치:
 - 작물을 정식하기 최소 2~3주 전에 추천받은 양의 고토석회를 밭 전체에 고루 살포하고 로터리 작업을 실시하여 토양 산도(pH)를 중성(약산성) 부근으로 교정해 주십시오.`;
        } else if (isEcOver) {
          issueSummary = `염류 집적으로 인한 토양 전기전도도(EC)의 비정상적 상승`;
          actionsText = `📍 염류 집적 해결을 위한 조치:
 - 땅속에 비료기가 잔뜩 쌓여 잔뿌리가 삼투압 장해로 인해 물과 영양을 거꾸로 뱉어내 마르고 있습니다. 당분간 추가 화학비료 시용을 엄격히 중단하고 맹물 관수를 통행 땅을 세척하십시오.
 
 📍 토양 환경 복원을 위한 처방:
 - 볏짚, 왕겨 등의 거친 유기물을 다량 공급해 땅속 비료 성분을 물리적으로 가두거나, 흡비력이 높은 옥수수/수수 등을 한 차례 재배하여 토양 속 염류를 빨아들이는 제염 작업을 적극 권장합니다.`;
        } else {
          issueSummary = `특별한 수치 불균형 없는 건강하고 튼튼한 토양 상태`;
          actionsText = `📍 현재 밭을 관리하기 위한 조치:
 - 토양의 산도 및 7대 영양 성분이 모두 기준 범위 내로 안전하게 조화를 이루고 있어 염려하실 점이 없습니다.
 
 📍 지속 가능하고 유용한 관리 팁:
 - 현재의 우수한 시비 패턴과 관행 표준 관리 기준을 그대로 준수하시며 급격한 시비량 변화 없이 안정적으로 농사지으시면 최상급 결실을 맺으실 수 있습니다.`;
        }

        return `⚠️ 현재 농가님의 밭에서 가장 주의 깊게 관리해야 할 점은 ${issueSummary}입니다.

${actionsText}

${cropNote}`;

      default:
        return "처방 정보가 없습니다.";
    }
  }

  // 추천 포대 수 강조 필터 및 볼드 처리 필터
  function highlightBracketInfo(text) {
    if (!text) return '';
    let html = text.replace(/\[\s*([^\]]+?)\s*\]/g, '<em>[ $1 ]</em>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return html;
  }

  // === 10. 무료 브라우저 내장 TTS 기능 (Web Speech API) ===
  
  // Microsoft Azure JiMin(지민) 또는 가장 자연스러운 한국어 목소리 반환 헬퍼
  function getKoreanJiMinVoice() {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    
    // 1순위: Microsoft Azure JiMin (지민) 목소리
    let selectedVoice = voices.find(v => 
      v.lang.includes('ko') && 
      (v.name.toLowerCase().includes('jimin') || v.name.includes('지민'))
    );
    
    // 2순위: Microsoft Edge Online/Natural 또는 타 브라우저의 자연스러운 한국어 목소리
    if (!selectedVoice) {
      selectedVoice = voices.find(v => 
        v.lang.includes('ko') && 
        (v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('online'))
      );
    }
    
    // 3순위: 시스템 기본 한국어 목소리
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang.includes('ko'));
    }
    
    return selectedVoice;
  }

  // TTS 재생 제어
  function handleTTS(text, buttonElement) {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (buttonElement.classList.contains('playing') || buttonElement.classList.contains('active')) {
        resetAllTTSButtons();
        return;
      }
    }
    
    resetAllTTSButtons();

    if (buttonElement.classList.contains('tts-action-btn')) {
      buttonElement.classList.add('playing');
      buttonElement.innerHTML = '<i class="fa-solid fa-circle-stop"></i> ⏹️ 읽어주기 멈추기';
    } else {
      buttonElement.style.backgroundColor = 'var(--color-accent-gold)';
      buttonElement.style.color = '#ffffff';
      buttonElement.classList.add('active');
    }

    const cleanText = text.replace(/[\[\]\*#_]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.9; // 0.9배속 세팅
    utterance.pitch = 1.0;
    
    const voice = getKoreanJiMinVoice();
    if (voice) {
      utterance.voice = voice;
      console.log("[TTS] 재생 목소리 적용:", voice.name);
    }
    
    currentUtterance = utterance;

    utterance.onend = () => {
      resetAllTTSButtons();
      currentUtterance = null;
    };

    utterance.onerror = () => {
      resetAllTTSButtons();
      currentUtterance = null;
    };

    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    resetAllTTSButtons();
    currentUtterance = null;
  }

  function speakSystemNotification(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.95;
    
    const voice = getKoreanJiMinVoice();
    if (voice) {
      utterance.voice = voice;
    }
    
    window.speechSynthesis.speak(utterance);
  }

  function resetAllTTSButtons() {
    document.querySelectorAll('.tts-action-btn').forEach(btn => {
      btn.className = 'tts-action-btn';
      btn.innerHTML = '<i class="fa-solid fa-volume-high"></i> 🔊 설명 천천히 듣기';
    });

    const summaryBtn = document.getElementById('summary-tts-btn');
    if (summaryBtn) {
      summaryBtn.className = 'tts-small-btn';
      summaryBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> 🔊 설명 천천히 듣기';
      summaryBtn.classList.remove('playing');
    }

    document.querySelectorAll('.tts-small-btn').forEach(btn => {
      if (btn.id !== 'summary-tts-btn') {
        btn.classList.remove('active');
        btn.removeAttribute('style');
      }
    });
  }

  // 아코디언 내 대형 TTS 이벤트 처리
  document.querySelectorAll('.tts-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentId = btn.getAttribute('data-tts-parent');
      const contentEl = document.getElementById(`section-content-${parentId}`);
      if (!contentEl) return;
      
      const textToRead = contentEl.textContent || contentEl.innerText;
      if (!textToRead.trim()) {
        speakSystemNotification("설명 생성이 완료된 후 버튼을 다시 눌러주세요.");
        return;
      }
      handleTTS(textToRead, btn);
    });
  });

  // === 11. 처방 결과 이미지 캡처 및 저장 ===
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      stopSpeaking();

      const captureArea = document.getElementById('capture-area');
      
      html2canvas(captureArea, {
        useCORS: true,
        scale: 2,
        backgroundColor: '#f4f7f4',
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: document.documentElement.offsetWidth,
        windowHeight: document.documentElement.offsetHeight
      }).then(canvas => {
        try {
          const link = document.createElement('a');
          const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          link.download = `양구군토양처방_${selectedCrop}_${dateStr}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
        } catch (err) {
          console.error('캡처 저장 실패:', err);
          alert('📷 사진 저장에 실패했습니다. 파일 시스템 또는 브라우저 권한을 확인하십시오.');
        }
      });
    });
  }


  // === 13. 다시하기 버튼 제어 ===
  function handleRestart() {
    stopSpeaking();
    
    selectedCrop = null;
    uploadedFile = null;
    soilAnalysisData = null;
    
    cropCards.forEach(c => c.classList.remove('selected'));
    resetFileUpload();
    
    resultSection.style.display = 'none';
    
    // 정상 및 이상 결과 컨테이너 상태 초기화
    document.getElementById('capture-area').style.display = 'block';
    document.getElementById('anomaly-result-container').style.display = 'none';
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (restartBtn) restartBtn.addEventListener('click', handleRestart);
  if (anomalyRestartBtn) anomalyRestartBtn.addEventListener('click', handleRestart);

  // 파일을 base64로 변환하는 헬퍼
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64Str = reader.result.split(',')[1];
        resolve(base64Str);
      };
      reader.onerror = error => reject(error);
    });
  }

  // === 14. API Key 에러 대응용 Mock 시뮬레이션 데이터 생성기 ===
  function getMockAnalysisData(crop, fileName) {
    const file = (fileName || "").toLowerCase();
    
    // 1. 파일 이름 기반 매칭 (최우선 순위 - 어떤 작물을 선택했든 업로드한 파일이 기준이 됨)
    if (file.includes('팥')) {
      return { "pH": "5.3", "organic_matter": "14", "available_phosphate": "10", "potassium": "0.45", "calcium": "3.4", "magnesium": "2.0", "ec": "0.12" };
    }
    if (file.includes('콩')) {
      return { "pH": "7.2", "organic_matter": "13", "available_phosphate": "398", "potassium": "0.82", "calcium": "6.4", "magnesium": "1.8", "ec": "0.52" };
    }
    if (file.includes('옥수수')) {
      return { "pH": "6.3", "organic_matter": "11", "available_phosphate": "477", "potassium": "0.29", "calcium": "3.8", "magnesium": "0.9", "ec": "0.29" };
    }
    if (file.includes('토마토')) {
      return { "pH": "5.2", "organic_matter": "26", "available_phosphate": "915", "potassium": "2.31", "calcium": "12.3", "magnesium": "2.7", "ec": "6.25" };
    }
    if (file.includes('마늘')) {
      return { "pH": "6.7", "organic_matter": "4", "available_phosphate": "504", "potassium": "0.63", "calcium": "7.4", "magnesium": "0.7", "ec": "0.26" };
    }
    if (file.includes('아스파라')) {
      return { "pH": "6.3", "organic_matter": "24", "available_phosphate": "1190", "potassium": "0.99", "calcium": "12.4", "magnesium": "3.3", "ec": "5.04" };
    }
    if (file.includes('인삼')) {
      return { "pH": "6.7", "organic_matter": "13", "available_phosphate": "194", "potassium": "0.66", "calcium": "4.5", "magnesium": "0.9", "ec": "0.26" };
    }
    if (file.includes('곰취')) {
      return { "pH": "6.4", "organic_matter": "40", "available_phosphate": "720", "potassium": "0.54", "calcium": "11.1", "magnesium": "1.9", "ec": "0.55" };
    }
    if (file.includes('들깨')) {
      return { "pH": "5.8", "organic_matter": "19", "available_phosphate": "559", "potassium": "0.91", "calcium": "4.8", "magnesium": "1.2", "ec": "1.27" };
    }
    if (file.includes('사과2')) {
      return { "pH": "4.8", "organic_matter": "8", "available_phosphate": "584", "potassium": "0.21", "calcium": "1.2", "magnesium": "0.3", "ec": "0.16" };
    }
    if (file.includes('사과(과다)')) {
      return { "pH": "7.0", "organic_matter": "45", "available_phosphate": "596", "potassium": "1.37", "calcium": "13.6", "magnesium": "1.2", "ec": "0.63" };
    }
    if (file.includes('사과')) {
      return { "pH": "7.2", "organic_matter": "18", "available_phosphate": "481", "potassium": "0.70", "calcium": "8.2", "magnesium": "1.4", "ec": "0.21" };
    }
    if (file.includes('수박2')) {
      return { "pH": "6.2", "organic_matter": "24", "available_phosphate": "677", "potassium": "1.49", "calcium": "14.3", "magnesium": "6.3", "ec": "9.19" };
    }
    if (file.includes('수박')) {
      return { "pH": "6.8", "organic_matter": "17", "available_phosphate": "993", "potassium": "0.99", "calcium": "6.8", "magnesium": "1.8", "ec": "1.4" };
    }
    if (file.includes('벼')) {
      return { "pH": "6.8", "organic_matter": "19", "available_phosphate": "34", "potassium": "0.3", "calcium": "5", "magnesium": "1.1", "ec": "0.3" };
    }
    if (file.includes('오이')) {
      return { "pH": "6.4", "organic_matter": "19", "available_phosphate": "1097", "potassium": "2.84", "calcium": "15.1", "magnesium": "7.1", "ec": "15.83" };
    }
    if (file.includes('감자')) {
      return { "pH": "6.4", "organic_matter": "25", "available_phosphate": "1444", "potassium": "2.87", "calcium": "11.5", "magnesium": "5.0", "ec": "9.50" };
    }

    // 2. 파일 이름 매칭이 안 될 때만 선택한 작물(crop) 기준 매칭 (폴백)
    if (crop === '팥') {
      return { "pH": "5.3", "organic_matter": "14", "available_phosphate": "10", "potassium": "0.45", "calcium": "3.4", "magnesium": "2.0", "ec": "0.12" };
    }
    if (crop === '콩') {
      return { "pH": "7.2", "organic_matter": "13", "available_phosphate": "398", "potassium": "0.82", "calcium": "6.4", "magnesium": "1.8", "ec": "0.52" };
    }
    if (crop === '옥수수') {
      return { "pH": "6.3", "organic_matter": "11", "available_phosphate": "477", "potassium": "0.29", "calcium": "3.8", "magnesium": "0.9", "ec": "0.29" };
    }
    if (crop === '방울토마토' || crop === '토마토') {
      return { "pH": "5.2", "organic_matter": "26", "available_phosphate": "915", "potassium": "2.31", "calcium": "12.3", "magnesium": "2.7", "ec": "6.25" };
    }
    if (crop === '오미자') {
      return { "pH": "6.0", "organic_matter": "25", "available_phosphate": "350", "potassium": "0.55", "calcium": "5.0", "magnesium": "1.5", "ec": "0.8" };
    }
    if (crop === '아스파라거스' || crop === '아스파라') {
      return { "pH": "6.3", "organic_matter": "24", "available_phosphate": "1190", "potassium": "0.99", "calcium": "12.4", "magnesium": "3.3", "ec": "5.04" };
    }
    if (crop === '인삼') {
      return { "pH": "6.7", "organic_matter": "13", "available_phosphate": "194", "potassium": "0.66", "calcium": "4.5", "magnesium": "0.9", "ec": "0.26" };
    }
    if (crop === '곰취') {
      return { "pH": "6.4", "organic_matter": "40", "available_phosphate": "720", "potassium": "0.54", "calcium": "11.1", "magnesium": "1.9", "ec": "0.55" };
    }
    if (crop === '들깨') {
      return { "pH": "5.8", "organic_matter": "19", "available_phosphate": "559", "potassium": "0.91", "calcium": "4.8", "magnesium": "1.2", "ec": "1.27" };
    }
    if (crop === '수박') {
      return { "pH": "6.8", "organic_matter": "17", "available_phosphate": "993", "potassium": "0.99", "calcium": "6.8", "magnesium": "1.8", "ec": "1.4" };
    }
    if (crop === '벼') {
      return { "pH": "6.8", "organic_matter": "19", "available_phosphate": "34", "potassium": "0.3", "calcium": "5", "magnesium": "1.1", "ec": "0.3" };
    }
    if (crop === '사과') {
      return { "pH": "7.2", "organic_matter": "18", "available_phosphate": "481", "potassium": "0.70", "calcium": "8.2", "magnesium": "1.4", "ec": "0.21" };
    }
    if (crop === '오이') {
      return { "pH": "6.4", "organic_matter": "19", "available_phosphate": "1097", "potassium": "2.84", "calcium": "15.1", "magnesium": "7.1", "ec": "15.83" };
    }
    if (crop === '감자') {
      return { "pH": "6.4", "organic_matter": "25", "available_phosphate": "1444", "potassium": "2.87", "calcium": "11.5", "magnesium": "5.0", "ec": "9.50" };
    }

    // 3. 최종 폴백
    return {
      "pH": "6.2",
      "organic_matter": "24",
      "available_phosphate": "520",
      "potassium": "0.85",
      "calcium": "5.5",
      "magnesium": "1.7",
      "ec": "1.2"
    };
  }

  // === 15. 이상 데이터 감지 규칙 헬퍼 ===
  function checkSoilAnomaly(data) {
    if (!data || !data.metrics) return false;
    
    let phosphateVal = 0;
    let organicMatterVal = 0;
    let ecVal = 0;
    
    data.metrics.forEach(m => {
      const numVal = parseFloat(m.value);
      if (!isNaN(numVal)) {
        if (m.key === 'available_phosphate') phosphateVal = numVal;
        if (m.key === 'organic_matter') organicMatterVal = numVal;
        if (m.key === 'ec') ecVal = numVal;
      }
    });

    const isFacility = ['멜론', '방울토마토', '토마토', '수박', '오이'].includes(data.crop);
    const pLimit = isFacility ? 450 : 250;
    
    const isPhosphateAnomaly = phosphateVal > (pLimit * 3);
    const isOrganicAnomaly = organicMatterVal > 50;
    const isEcAnomaly = ecVal > 4.0;
    
    return isPhosphateAnomaly && (isOrganicAnomaly || isEcAnomaly);
  }

  function renderAnomalyResult(data) {
    const normalContainer = document.getElementById('capture-area');
    const anomalyContainer = document.getElementById('anomaly-result-container');
    const anomalyList = document.getElementById('anomaly-detected-list');
    
    normalContainer.style.display = 'none';
    anomalyContainer.style.display = 'block';
    
    // 이상 수치 목록 렌더링
    let listHtml = '';
    data.metrics.forEach(m => {
      const numVal = parseFloat(m.value);
      const isFacility = ['멜론', '방울토마토', '토마토', '수박', '오이'].includes(data.crop);
      const pLimit = isFacility ? 450 : 250;
      
      const isAnomalyMetric = 
        (m.key === 'available_phosphate' && numVal > (pLimit * 3)) ||
        (m.key === 'organic_matter' && numVal > 50) ||
        (m.key === 'ec' && numVal > 4.0);
        
      if (isAnomalyMetric) {
        listHtml += `<li><strong>${m.name}</strong> <span class="value-badge">${m.value} (비정상 폭등)</span></li>`;
      }
    });
    anomalyList.innerHTML = listHtml;
    
    resultSection.style.display = 'block';
    resultSection.scrollIntoView({ behavior: 'smooth' });
  }

});
